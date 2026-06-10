<?php

declare(strict_types=1);

namespace GptImages;

use RuntimeException;

final class NeurogateClient
{
    private $config;
    private $extractor;

    public function __construct(Config $config, ResponseImageExtractor $extractor)
    {
        $this->config = $config;
        $this->extractor = $extractor;
    }

    public function generate(string $prompt, array $referenceDataUrls = [], ?string $size = null): array
    {
        $decoded = $this->response($this->imagePayload($prompt, $referenceDataUrls, $size));

        $images = $this->extractor->images($decoded);

        return [
            'id' => is_array($decoded) && isset($decoded['id']) ? (string) $decoded['id'] : null,
            'images' => $images,
            'text' => $this->extractor->text($decoded),
            'usage' => $this->extractor->usage($decoded),
            'raw' => $decoded,
        ];
    }

    public function chat(array $messages): array
    {
        $decoded = $this->response($this->chatPayload($messages));
        $text = $this->extractor->text($decoded);

        return [
            'id' => is_array($decoded) && isset($decoded['id']) ? (string) $decoded['id'] : null,
            'text' => $text,
            'usage' => $this->extractor->usage($decoded),
            'raw' => $decoded,
        ];
    }

    private function imagePayload(string $prompt, array $referenceDataUrls, ?string $size): array
    {
        $tool = [
            'type' => 'image_generation',
            'action' => count($referenceDataUrls) > 0 ? 'edit' : 'generate',
            'output_format' => $this->config->string('image.output_format', 'png'),
        ];

        if ($size !== null) {
            $tool['size'] = $size;
        }

        foreach (['quality', 'background'] as $key) {
            $value = $this->config->nullableString('image.' . $key);

            if ($value !== null) {
                $tool[$key] = $value;
            }
        }

        $content = [
            ['type' => 'input_text', 'text' => $prompt],
        ];

        foreach ($referenceDataUrls as $dataUrl) {
            $content[] = ['type' => 'input_image', 'image_url' => $dataUrl];
        }

        $payload = [
            'model' => $this->config->string('api.model', 'gpt-5.5'),
            'instructions' => $this->config->string('prompts.image'),
            'input' => [
                ['role' => 'user', 'content' => $content],
            ],
            'tools' => [$tool],
            'store' => $this->config->boolean('api.store', false),
            'stream' => $this->config->boolean('api.stream', false),
        ];

        if ($this->config->boolean('api.force_image_tool', true)) {
            $payload['tool_choice'] = ['type' => 'image_generation'];
        }

        return $payload;
    }

    private function chatPayload(array $messages): array
    {
        return [
            'model' => $this->config->string('api.model', 'gpt-5.5'),
            'instructions' => $this->config->string('prompts.chat'),
            'input' => $this->chatInput($messages),
            'store' => $this->config->boolean('api.store', false),
            'stream' => $this->config->boolean('api.stream', false),
        ];
    }

    private function chatInput(array $messages): array
    {
        $input = [];

        foreach ($messages as $message) {
            if (!is_array($message)) {
                continue;
            }

            $role = ($message['role'] ?? '') === 'assistant' ? 'assistant' : 'user';
            $content = isset($message['content']) ? trim((string) $message['content']) : '';

            if ($content === '') {
                continue;
            }

            $input[] = [
                'role' => $role,
                'content' => $content,
            ];
        }

        return $input;
    }

    private function response(array $payload): array
    {
        $body = $this->post('/responses', $payload);
        $decoded = json_decode($body, true);

        if (!is_array($decoded)) {
            $decoded = $this->extractor->sseEvents($body);
        }

        if (!is_array($decoded)) {
            throw new RuntimeException('API returned an unreadable response.');
        }

        return $decoded;
    }

    private function post(string $endpoint, array $payload): string
    {
        $token = $this->config->string('api.token');

        if ($token === '' || $token === 'sk-...') {
            throw new RuntimeException('API token is not configured in config.php.');
        }

        $url = rtrim($this->config->string('api.base_url'), '/') . $endpoint;
        $json = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

        if ($json === false) {
            throw new RuntimeException('Unable to encode API request.');
        }

        if (function_exists('curl_init')) {
            return $this->postWithCurl($url, $json, $token);
        }

        return $this->postWithStreams($url, $json, $token);
    }

    private function postWithCurl(string $url, string $json, string $token): string
    {
        $curl = curl_init($url);

        if ($curl === false) {
            throw new RuntimeException('Unable to initialize curl.');
        }

        curl_setopt_array($curl, [
            CURLOPT_POST => true,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER => [
                'Authorization: Bearer ' . $token,
                'Content-Type: application/json',
            ],
            CURLOPT_POSTFIELDS => $json,
            CURLOPT_TIMEOUT => $this->config->integer('api.timeout_seconds', 300),
        ]);

        $body = curl_exec($curl);
        $status = (int) curl_getinfo($curl, CURLINFO_HTTP_CODE);
        $error = curl_error($curl);
        curl_close($curl);

        if ($body === false) {
            throw new RuntimeException('API request failed: ' . $error);
        }

        if ($status >= 400) {
            throw new RuntimeException('API HTTP ' . $status . ': ' . $this->shortBody((string) $body));
        }

        return (string) $body;
    }

    private function postWithStreams(string $url, string $json, string $token): string
    {
        $context = stream_context_create([
            'http' => [
                'method' => 'POST',
                'timeout' => $this->config->integer('api.timeout_seconds', 300),
                'header' => "Authorization: Bearer {$token}\r\nContent-Type: application/json\r\n",
                'content' => $json,
                'ignore_errors' => true,
            ],
        ]);

        $body = file_get_contents($url, false, $context);
        $status = 0;

        foreach ($http_response_header ?? [] as $header) {
            if (preg_match('/^HTTP\/\S+\s+(\d+)/', $header, $matches) === 1) {
                $status = (int) $matches[1];
                break;
            }
        }

        if ($body === false) {
            throw new RuntimeException('API request failed.');
        }

        if ($status >= 400) {
            throw new RuntimeException('API HTTP ' . $status . ': ' . $this->shortBody((string) $body));
        }

        return (string) $body;
    }

    private function shortBody(string $body): string
    {
        $body = trim($body);

        if (function_exists('mb_substr')) {
            return mb_substr($body, 0, 800, 'UTF-8');
        }

        return substr($body, 0, 800);
    }
}
