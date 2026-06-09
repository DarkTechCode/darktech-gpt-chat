<?php

declare(strict_types=1);

namespace GptImages;

use RuntimeException;

final class ChatRepository
{
    private $filePath;

    public function __construct(string $dataDir)
    {
        if (!is_dir($dataDir) && !mkdir($dataDir, 0775, true)) {
            throw new RuntimeException('Unable to create data directory.');
        }

        $this->filePath = rtrim($dataDir, '/\\') . DIRECTORY_SEPARATOR . 'chats.json';
    }

    public function summaries(): array
    {
        $data = $this->readData();
        $summaries = [];

        foreach ($data['chats'] as $chat) {
            $summaries[] = [
                'id' => $chat['id'],
                'title' => $chat['title'],
                'createdAt' => $chat['createdAt'],
                'updatedAt' => $chat['updatedAt'],
                'preview' => $this->preview($chat),
                'imageCount' => $this->imageCount($chat),
                'usage' => $this->usageSummary($chat),
            ];
        }

        usort($summaries, static function (array $left, array $right): int {
            return strcmp($right['updatedAt'], $left['updatedAt']);
        });

        return $summaries;
    }

    public function totals(): array
    {
        $data = $this->readData();
        $total = $this->emptyUsage();

        foreach ($data['chats'] as $chat) {
            $total = $this->addSummary($total, $this->usageSummary($chat));
        }

        return $total;
    }

    public function imageContextMap(): array
    {
        $data = $this->readData();
        $map = [];

        foreach ($data['chats'] as $chat) {
            foreach ($chat['messages'] as $message) {
                $usage = isset($message['usage']) && is_array($message['usage']) ? $message['usage'] : null;

                foreach (($message['images'] ?? []) as $image) {
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
        }

        return $map;
    }

    public function get(string $chatId): ?array
    {
        $data = $this->readData();

        foreach ($data['chats'] as $chat) {
            if ($chat['id'] === $chatId) {
                return $this->withUsage($chat);
            }
        }

        return null;
    }

    public function create(string $title = 'Новый чат'): array
    {
        return $this->withExclusiveLock(function (array $data) use ($title): array {
            $chat = [
                'id' => $this->newId('chat'),
                'title' => $this->shortText($title, 64) ?: 'Новый чат',
                'createdAt' => $this->now(),
                'updatedAt' => $this->now(),
                'messages' => [],
            ];

            $data['chats'][] = $chat;

            return ['data' => $data, 'result' => $this->withUsage($chat)];
        });
    }

    public function appendMessage(string $chatId, array $message): array
    {
        return $this->withExclusiveLock(function (array $data) use ($chatId, $message): array {
            foreach ($data['chats'] as $index => $chat) {
                if ($chat['id'] !== $chatId) {
                    continue;
                }

                $chat['messages'][] = $message;
                $chat['updatedAt'] = $message['createdAt'] ?? $this->now();

                if ($chat['title'] === 'Новый чат' && $message['role'] === 'user') {
                    $chat['title'] = $this->shortText((string) $message['content'], 64) ?: 'Новый чат';
                }

                $data['chats'][$index] = $chat;

                return ['data' => $data, 'result' => $this->withUsage($chat)];
            }

            throw new RuntimeException('Chat was not found.');
        });
    }

    public function newMessage(string $role, string $content, array $extra = []): array
    {
        return array_merge([
            'id' => $this->newId('msg'),
            'role' => $role,
            'content' => $content,
            'createdAt' => $this->now(),
            'images' => [],
        ], $extra);
    }

    private function readData(): array
    {
        if (!is_file($this->filePath)) {
            return $this->emptyData();
        }

        $handle = fopen($this->filePath, 'rb');

        if ($handle === false) {
            throw new RuntimeException('Unable to read chat storage.');
        }

        flock($handle, LOCK_SH);
        $contents = stream_get_contents($handle);
        flock($handle, LOCK_UN);
        fclose($handle);

        return $this->decode((string) $contents);
    }

    private function withExclusiveLock(callable $callback): array
    {
        $handle = fopen($this->filePath, 'c+b');

        if ($handle === false) {
            throw new RuntimeException('Unable to open chat storage.');
        }

        flock($handle, LOCK_EX);
        rewind($handle);
        $data = $this->decode((string) stream_get_contents($handle));
        $mutation = $callback($data);

        rewind($handle);
        ftruncate($handle, 0);
        fwrite($handle, json_encode($mutation['data'], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
        fflush($handle);
        flock($handle, LOCK_UN);
        fclose($handle);

        return $mutation['result'];
    }

    private function decode(string $contents): array
    {
        if (trim($contents) === '') {
            return $this->emptyData();
        }

        $data = json_decode($contents, true);

        if (!is_array($data) || !isset($data['chats']) || !is_array($data['chats'])) {
            return $this->emptyData();
        }

        return $data;
    }

    private function emptyData(): array
    {
        return ['version' => 1, 'chats' => []];
    }

    private function preview(array $chat): string
    {
        $messages = array_reverse($chat['messages']);

        foreach ($messages as $message) {
            if (!empty($message['content'])) {
                return $this->shortText((string) $message['content'], 96);
            }
        }

        return '';
    }

    private function imageCount(array $chat): int
    {
        $count = 0;

        foreach ($chat['messages'] as $message) {
            $count += isset($message['images']) && is_array($message['images']) ? count($message['images']) : 0;
        }

        return $count;
    }

    private function withUsage(array $chat): array
    {
        $chat['usage'] = $this->usageSummary($chat);

        return $chat;
    }

    private function usageSummary(array $chat): array
    {
        $summary = $this->emptyUsage();

        foreach ($chat['messages'] as $message) {
            $usage = null;

            if (isset($message['usage']) && is_array($message['usage'])) {
                $usage = $message['usage'];
            } elseif (isset($message['api']['usage']) && is_array($message['api']['usage'])) {
                $usage = $message['api']['usage'];
            }

            if ($usage !== null) {
                $summary = $this->addUsage($summary, $usage);
            }
        }

        return $summary;
    }

    private function addSummary(array $total, array $summary): array
    {
        if (!$summary['hasUsage']) {
            return $total;
        }

        $total['hasUsage'] = true;
        $total['requestCount'] += $summary['requestCount'];
        $total['inputTokens'] += $summary['inputTokens'];
        $total['outputTokens'] += $summary['outputTokens'];
        $total['totalTokens'] += $summary['totalTokens'];

        return $total;
    }

    private function addUsage(array $summary, array $usage): array
    {
        $input = $this->usageInteger($usage, ['inputTokens', 'input_tokens', 'prompt_tokens']);
        $output = $this->usageInteger($usage, ['outputTokens', 'output_tokens', 'completion_tokens']);
        $total = $this->usageInteger($usage, ['totalTokens', 'total_tokens']);

        if ($total === 0 && ($input > 0 || $output > 0)) {
            $total = $input + $output;
        }

        if ($input === 0 && $output === 0 && $total === 0) {
            return $summary;
        }

        $summary['hasUsage'] = true;
        $summary['requestCount']++;
        $summary['inputTokens'] += $input;
        $summary['outputTokens'] += $output;
        $summary['totalTokens'] += $total;

        return $summary;
    }

    private function emptyUsage(): array
    {
        return [
            'hasUsage' => false,
            'requestCount' => 0,
            'inputTokens' => 0,
            'outputTokens' => 0,
            'totalTokens' => 0,
        ];
    }

    private function usageInteger(array $usage, array $keys): int
    {
        foreach ($keys as $key) {
            if (isset($usage[$key]) && is_numeric($usage[$key])) {
                return (int) $usage[$key];
            }
        }

        return 0;
    }

    private function shortText(string $text, int $limit): string
    {
        $text = trim((string) preg_replace('/\s+/u', ' ', $text));

        if (function_exists('mb_strlen') && function_exists('mb_substr')) {
            return mb_strlen($text, 'UTF-8') > $limit ? mb_substr($text, 0, $limit - 1, 'UTF-8') . '…' : $text;
        }

        return strlen($text) > $limit ? substr($text, 0, $limit - 1) . '...' : $text;
    }

    private function newId(string $prefix): string
    {
        return $prefix . '_' . bin2hex(random_bytes(12));
    }

    private function now(): string
    {
        return gmdate('c');
    }
}
