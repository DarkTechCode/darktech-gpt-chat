<?php

declare(strict_types=1);

namespace GptImages;

final class ResponseImageExtractor
{
    public function images(array $payload): array
    {
        $images = [];
        $this->collectImages($payload, $images);

        return $images;
    }

    public function text(array $payload): string
    {
        $parts = [];
        $deltas = [];
        $this->collectText($payload, $parts, $deltas);

        $parts = array_values(array_unique(array_filter($parts, static function (string $part): bool {
            return trim($part) !== '';
        })));

        if (count($parts) > 0) {
            return trim(implode("\n", $parts));
        }

        return trim(implode('', $deltas));
    }

    public function usage(array $payload): ?array
    {
        $candidates = [];
        $this->collectUsage($payload, $candidates);

        return count($candidates) > 0 ? $candidates[count($candidates) - 1] : null;
    }

    public function sseEvents(string $body): array
    {
        $events = [];
        $blocks = preg_split('/\R{2,}/', trim($body));

        foreach ($blocks ?: [] as $block) {
            $lines = preg_split('/\R/', $block);
            $data = [];

            foreach ($lines ?: [] as $line) {
                if (strpos($line, 'data:') === 0) {
                    $data[] = trim(substr($line, 5));
                }
            }

            $json = trim(implode("\n", $data));

            if ($json === '' || $json === '[DONE]') {
                continue;
            }

            $decoded = json_decode($json, true);

            if (is_array($decoded)) {
                $events[] = $decoded;
            }
        }

        return $events;
    }

    private function collectImages($value, array &$images): void
    {
        if (is_array($value)) {
            if (($value['type'] ?? '') === 'image_generation_call' && !empty($value['result'])) {
                $images[] = (string) $value['result'];
            }

            if (!empty($value['b64_json']) && is_string($value['b64_json'])) {
                $images[] = $value['b64_json'];
            }

            foreach ($value as $nested) {
                $this->collectImages($nested, $images);
            }
        }
    }

    private function collectText($value, array &$parts, array &$deltas): void
    {
        if (!is_array($value)) {
            return;
        }

        if (isset($value['output_text']) && is_string($value['output_text'])) {
            $parts[] = $value['output_text'];
        }

        if (($value['type'] ?? '') === 'output_text' && isset($value['text'])) {
            $parts[] = (string) $value['text'];
        }

        if (($value['type'] ?? '') === 'response.output_text.done' && isset($value['text'])) {
            $parts[] = (string) $value['text'];
        }

        if (($value['type'] ?? '') === 'response.output_text.delta' && isset($value['delta'])) {
            $deltas[] = (string) $value['delta'];
        }

        foreach ($value as $nested) {
            $this->collectText($nested, $parts, $deltas);
        }
    }

    private function collectUsage($value, array &$candidates): void
    {
        if (!is_array($value)) {
            return;
        }

        if (isset($value['usage']) && is_array($value['usage'])) {
            $usage = $this->normalizeUsage($value['usage']);

            if ($usage !== null) {
                $candidates[] = $usage;
            }
        }

        $usage = $this->normalizeUsage($value);

        if ($usage !== null) {
            $candidates[] = $usage;
        }

        foreach ($value as $nested) {
            $this->collectUsage($nested, $candidates);
        }
    }

    private function normalizeUsage(array $usage): ?array
    {
        $inputTokens = $this->integerValue($usage, ['input_tokens', 'prompt_tokens']);
        $outputTokens = $this->integerValue($usage, ['output_tokens', 'completion_tokens']);
        $totalTokens = $this->integerValue($usage, ['total_tokens']);

        if ($totalTokens === null && ($inputTokens !== null || $outputTokens !== null)) {
            $totalTokens = (int) $inputTokens + (int) $outputTokens;
        }

        if ($inputTokens === null && $outputTokens === null && $totalTokens === null) {
            return null;
        }

        return [
            'inputTokens' => $inputTokens,
            'outputTokens' => $outputTokens,
            'totalTokens' => $totalTokens,
            'raw' => $usage,
        ];
    }

    private function integerValue(array $source, array $keys): ?int
    {
        foreach ($keys as $key) {
            if (isset($source[$key]) && is_numeric($source[$key])) {
                return (int) $source[$key];
            }
        }

        return null;
    }
}
