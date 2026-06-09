<?php

declare(strict_types=1);

namespace GptImages;

use RuntimeException;

final class ImageStorage
{
    private $directory;
    private $urlPrefix;
    private $maxUploadBytes;

    public function __construct(string $directory, string $urlPrefix, int $maxUploadBytes)
    {
        if (!is_dir($directory) && !mkdir($directory, 0775, true)) {
            throw new RuntimeException('Unable to create image directory.');
        }

        $this->directory = rtrim($directory, '/\\');
        $this->urlPrefix = trim($urlPrefix, '/');
        $this->maxUploadBytes = $maxUploadBytes;
    }

    public function saveGenerated(array $base64Images, string $format, string $prompt, ?array $usage = null): array
    {
        $images = [];
        $index = 1;

        foreach ($base64Images as $base64) {
            $extension = $this->extensionFromFormat($format);
            $path = $this->uniquePath('gen', $extension, $index);
            $bytes = base64_decode($this->stripDataUrl((string) $base64), true);

            if ($bytes === false || $bytes === '') {
                throw new RuntimeException('Generated image data is not valid base64.');
            }

            if (getimagesizefromstring($bytes) === false) {
                throw new RuntimeException('Generated image data is not a readable image.');
            }

            file_put_contents($path, $bytes);
            $extra = ['prompt' => $prompt];

            if ($usage !== null) {
                $extra['usage'] = $usage;
                $extra['usageScope'] = 'response';
            }

            $images[] = $this->meta($path, 'generated', $extra);
            $index++;
        }

        return $images;
    }

    public function saveUploads(array $files): array
    {
        $saved = [];

        foreach ($this->normalizeFiles($files) as $file) {
            if ((int) $file['error'] === UPLOAD_ERR_NO_FILE) {
                continue;
            }

            if ((int) $file['error'] !== UPLOAD_ERR_OK) {
                throw new RuntimeException('Reference image upload failed.');
            }

            if ((int) $file['size'] > $this->maxUploadBytes) {
                throw new RuntimeException('Reference image is too large.');
            }

            $info = getimagesize((string) $file['tmp_name']);

            if ($info === false || empty($info['mime'])) {
                throw new RuntimeException('Uploaded reference must be an image.');
            }

            $extension = $this->extensionFromMime((string) $info['mime']);
            $path = $this->uniquePath('ref', $extension, count($saved) + 1);

            if (!move_uploaded_file((string) $file['tmp_name'], $path)) {
                throw new RuntimeException('Unable to save uploaded reference.');
            }

            $saved[] = $this->meta($path, 'reference', [
                'originalName' => (string) $file['name'],
            ]);
        }

        return $saved;
    }

    public function metaFromRelativePath(string $relativePath): array
    {
        $path = $this->absoluteFromRelativePath($relativePath);

        return $this->meta($path, 'reference');
    }

    public function dataUrlFromRelativePath(string $relativePath): string
    {
        $path = $this->absoluteFromRelativePath($relativePath);
        $mime = $this->mime($path);

        return 'data:' . $mime . ';base64,' . base64_encode((string) file_get_contents($path));
    }

    public function listImages(array $contextByFile = []): array
    {
        $images = [];

        foreach (['png', 'jpg', 'jpeg', 'webp'] as $extension) {
            foreach (glob($this->directory . DIRECTORY_SEPARATOR . '*.' . $extension) ?: [] as $path) {
                $meta = $this->meta($path, strpos(basename($path), 'ref-') === 0 ? 'reference' : 'generated');

                if (isset($contextByFile[$meta['file']]) && is_array($contextByFile[$meta['file']])) {
                    $context = $contextByFile[$meta['file']];
                    $meta['chatId'] = $context['chatId'] ?? null;
                    $meta['chatTitle'] = $context['chatTitle'] ?? null;

                    if (isset($context['usage']) && is_array($context['usage'])) {
                        $meta['usage'] = $context['usage'];
                        $meta['usageScope'] = 'response';
                    }
                }

                $images[] = $meta;
            }
        }

        usort($images, static function (array $left, array $right): int {
            return (int) $right['modifiedAt'] <=> (int) $left['modifiedAt'];
        });

        return $images;
    }

    private function normalizeFiles(array $files): array
    {
        if (!isset($files['name'])) {
            return [];
        }

        if (!is_array($files['name'])) {
            return [$files];
        }

        $normalized = [];

        foreach ($files['name'] as $index => $name) {
            $normalized[] = [
                'name' => $name,
                'type' => $files['type'][$index] ?? '',
                'tmp_name' => $files['tmp_name'][$index] ?? '',
                'error' => $files['error'][$index] ?? UPLOAD_ERR_NO_FILE,
                'size' => $files['size'][$index] ?? 0,
            ];
        }

        return $normalized;
    }

    private function meta(string $path, string $kind, array $extra = []): array
    {
        $size = getimagesize($path) ?: [0, 0];
        $fileName = basename($path);

        return array_merge([
            'kind' => $kind,
            'file' => $fileName,
            'path' => $this->urlPrefix . '/' . rawurlencode($fileName),
            'url' => $this->urlPrefix . '/' . rawurlencode($fileName),
            'width' => (int) $size[0],
            'height' => (int) $size[1],
            'bytes' => filesize($path) ?: 0,
            'mime' => $this->mime($path),
            'modifiedAt' => filemtime($path) ?: time(),
        ], $extra);
    }

    private function uniquePath(string $prefix, string $extension, int $index): string
    {
        do {
            $name = sprintf('%s-%s-%s-%02d.%s', $prefix, gmdate('Ymd-His'), bin2hex(random_bytes(4)), $index, $extension);
            $path = $this->directory . DIRECTORY_SEPARATOR . $name;
        } while (is_file($path));

        return $path;
    }

    private function absoluteFromRelativePath(string $relativePath): string
    {
        $fileName = basename(str_replace('\\', '/', $relativePath));
        $path = $this->directory . DIRECTORY_SEPARATOR . $fileName;
        $realDirectory = realpath($this->directory);
        $realPath = realpath($path);

        if ($realDirectory === false || $realPath === false || strpos($realPath, $realDirectory . DIRECTORY_SEPARATOR) !== 0) {
            throw new RuntimeException('Image reference was not found.');
        }

        return $realPath;
    }

    private function extensionFromFormat(string $format): string
    {
        $format = strtolower($format);

        return $format === 'jpeg' ? 'jpg' : $format;
    }

    private function extensionFromMime(string $mime): string
    {
        $map = [
            'image/png' => 'png',
            'image/jpeg' => 'jpg',
            'image/webp' => 'webp',
        ];

        if (!isset($map[$mime])) {
            throw new RuntimeException('Only PNG, JPEG and WEBP references are supported.');
        }

        return $map[$mime];
    }

    private function stripDataUrl(string $base64): string
    {
        if (preg_match('/^data:[^;]+;base64,(.+)$/', $base64, $matches) === 1) {
            return $matches[1];
        }

        return $base64;
    }

    private function mime(string $path): string
    {
        if (function_exists('mime_content_type')) {
            $mime = mime_content_type($path);

            if (is_string($mime) && $mime !== '') {
                return $mime;
            }
        }

        $size = getimagesize($path);

        return is_array($size) && !empty($size['mime']) ? (string) $size['mime'] : 'application/octet-stream';
    }
}
