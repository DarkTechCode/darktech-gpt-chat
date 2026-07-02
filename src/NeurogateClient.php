<?php

declare(strict_types=1);

namespace GptImages;

use RuntimeException;

final class NeurogateClient
{
    private $config;
    private $extractor;
    private $transport;

    public function __construct(Config $config, ResponseImageExtractor $extractor, ?ResponsesTransport $transport = null)
    {
        $this->config = $config;
        $this->extractor = $extractor;
        $this->transport = $transport ?? new ResponsesTransport($config);
    }

    public function generate(string $prompt, array $referenceDataUrls = [], ?string $size = null): array
    {
        $decoded = $this->response($this->imagePayload($prompt, $referenceDataUrls, $size));

        return $this->imageResult($decoded);
    }

    public function generateMany(string $prompt, array $referenceDataUrls = [], ?string $size = null, int $requestCount = 1): array
    {
        $requestCount = max(1, $requestCount);
        $payloads = [];

        for ($index = 0; $index < $requestCount; $index++) {
            $payloads[] = $this->imagePayload($prompt, $referenceDataUrls, $size);
        }

        $results = [];

        foreach ($this->responses($payloads) as $decoded) {
            $results[] = $this->imageResult($decoded);
        }

        return $results;
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

    private function imageResult(array $decoded): array
    {
        $images = $this->extractor->images($decoded);

        return [
            'id' => is_array($decoded) && isset($decoded['id']) ? (string) $decoded['id'] : null,
            'images' => $images,
            'text' => $this->extractor->text($decoded),
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
        return $this->decodedResponseBody($this->transport->post('/responses', $payload));
    }

    private function responses(array $payloads): array
    {
        $responses = [];

        foreach ($this->transport->postMany('/responses', $payloads) as $body) {
            $responses[] = $this->decodedResponseBody($body);
        }

        return $responses;
    }

    private function decodedResponseBody(string $body): array
    {
        $decoded = json_decode($body, true);

        if (!is_array($decoded)) {
            $decoded = $this->extractor->sseEvents($body);
        }

        if (!is_array($decoded)) {
            throw new RuntimeException('API returned an unreadable response.');
        }

        return $decoded;
    }
}
