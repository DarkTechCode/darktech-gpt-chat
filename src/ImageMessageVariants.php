<?php

declare(strict_types=1);

namespace GptImages;

use RuntimeException;

final class ImageMessageVariants
{
    public static function assertVariant(array $variant): void
    {
        if (!isset($variant['id']) || !is_string($variant['id']) || trim($variant['id']) === '') {
            throw new RuntimeException('Variant id is required.');
        }
    }

    public static function assertImageAssistantMessage(array $message): void
    {
        if (($message['role'] ?? '') !== 'assistant' || ($message['mode'] ?? '') !== 'image') {
            throw new RuntimeException('Сообщение генерации не найдено.');
        }
    }

    public static function requestContext(array $messages, array $message, int $assistantIndex): array
    {
        self::assertImageAssistantMessage($message);

        return self::imageRequestContext(self::findImageRequest($messages, $message, $assistantIndex), $message);
    }

    public static function findVariant(array $message, string $variantId): array
    {
        foreach (self::storedVariants($message) as $variant) {
            if (($variant['id'] ?? '') === $variantId) {
                return $variant;
            }
        }

        throw new RuntimeException('Вариант генерации не найден.');
    }

    public static function applyVariantToMessage(array $message, array $variant): array
    {
        $message['content'] = isset($variant['content']) ? (string) $variant['content'] : '';
        $message['images'] = isset($variant['images']) && is_array($variant['images']) ? $variant['images'] : [];
        unset($message['usage'], $message['api']);

        if (isset($variant['usage']) && is_array($variant['usage'])) {
            $message['usage'] = $variant['usage'];
        }

        if (isset($variant['api']) && is_array($variant['api'])) {
            $message['api'] = $variant['api'];
        }

        return $message;
    }

    public static function variantsForAppend(array $message, string $fallbackMessageId, string $now): array
    {
        $variants = self::storedVariants($message);

        if (count($variants) > 0) {
            return $variants;
        }

        return [self::variantFromMessage($message, $fallbackMessageId, $now)];
    }

    public static function storedVariants(array $message): array
    {
        if (!isset($message['variants']) || !is_array($message['variants'])) {
            return [];
        }

        $variants = [];

        foreach ($message['variants'] as $variant) {
            if (is_array($variant)) {
                $variants[] = $variant;
            }
        }

        return $variants;
    }

    public static function hasVariants(array $message): bool
    {
        return count(self::storedVariants($message)) > 0;
    }

    public static function usageFromSource(array $source): ?array
    {
        if (isset($source['usage']) && is_array($source['usage'])) {
            return $source['usage'];
        }

        if (isset($source['api']['usage']) && is_array($source['api']['usage'])) {
            return $source['api']['usage'];
        }

        return null;
    }

    public static function addGeneratedImageContext(array &$map, array $chat, array $source): void
    {
        $usage = self::usageFromSource($source);

        foreach (($source['images'] ?? []) as $image) {
            if (!is_array($image) || empty($image['file']) || ($image['kind'] ?? '') !== 'generated') {
                continue;
            }

            $entry = [
                'chatId' => $chat['id'],
                'chatTitle' => $chat['title'],
            ];

            if (isset($image['usage']) && is_array($image['usage'])) {
                $entry['usage'] = $image['usage'];
            } elseif ($usage !== null) {
                $entry['usage'] = $usage;
            }

            $map[(string) $image['file']] = $entry;
        }
    }

    private static function findImageRequest(array $messages, array $message, int $assistantIndex): array
    {
        $requestId = isset($message['request']['messageId']) && is_string($message['request']['messageId'])
            ? $message['request']['messageId']
            : '';

        if ($requestId !== '') {
            foreach ($messages as $request) {
                if (is_array($request) && ($request['id'] ?? '') === $requestId) {
                    return $request;
                }
            }
        }

        for ($index = $assistantIndex - 1; $index >= 0; $index--) {
            $request = $messages[$index] ?? null;

            if (is_array($request) && ($request['role'] ?? '') === 'user' && ($request['mode'] ?? '') === 'image') {
                return $request;
            }
        }

        throw new RuntimeException('Исходный запрос генерации не найден.');
    }

    private static function imageRequestContext(array $request, array $message): array
    {
        $prompt = isset($request['content']) ? trim((string) $request['content']) : '';

        if ($prompt === '') {
            throw new RuntimeException('Текст генерации не найден.');
        }

        $settings = isset($request['settings']) && is_array($request['settings']) ? $request['settings'] : [];
        $api = isset($message['api']) && is_array($message['api']) ? $message['api'] : [];
        $size = null;
        $ratio = '';
        $imageCount = self::imageCount($settings, $api, $message);

        if (isset($settings['size']) && is_string($settings['size']) && trim($settings['size']) !== '') {
            $size = trim($settings['size']);
        } elseif (isset($api['size']) && is_string($api['size']) && trim($api['size']) !== '') {
            $size = trim($api['size']);
        }

        if (isset($settings['ratio']) && is_string($settings['ratio'])) {
            $ratio = trim($settings['ratio']);
        } elseif (isset($api['ratio']) && is_string($api['ratio'])) {
            $ratio = trim($api['ratio']);
        }

        return [
            'prompt' => $prompt,
            'references' => isset($request['images']) && is_array($request['images']) ? $request['images'] : [],
            'ratio' => $ratio,
            'size' => $size,
            'imageCount' => $imageCount,
        ];
    }

    private static function imageCount(array $settings, array $api, array $message): int
    {
        $count = null;

        if (isset($settings['imageCount']) && is_numeric($settings['imageCount'])) {
            $count = (int) $settings['imageCount'];
        } elseif (isset($api['imageCount']) && is_numeric($api['imageCount'])) {
            $count = (int) $api['imageCount'];
        } elseif (isset($message['images']) && is_array($message['images']) && count($message['images']) > 0) {
            $count = count($message['images']);
        }

        if ($count === null) {
            return 1;
        }

        return min(10, max(1, $count));
    }

    private static function variantFromMessage(array $message, string $fallbackMessageId, string $now): array
    {
        $messageId = isset($message['id']) && is_string($message['id']) && $message['id'] !== ''
            ? $message['id']
            : $fallbackMessageId;
        $variant = [
            'id' => $messageId . '_variant_1',
            'content' => isset($message['content']) ? (string) $message['content'] : '',
            'createdAt' => isset($message['createdAt']) ? (string) $message['createdAt'] : $now,
            'images' => isset($message['images']) && is_array($message['images']) ? $message['images'] : [],
        ];
        $usage = self::usageFromSource($message);

        if ($usage !== null) {
            $variant['usage'] = $usage;
        }

        if (isset($message['api']) && is_array($message['api'])) {
            $variant['api'] = $message['api'];
        }

        return $variant;
    }
}
