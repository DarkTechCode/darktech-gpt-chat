<?php

declare(strict_types=1);

use GptImages\JsonResponse;

$container = require __DIR__ . '/../src/bootstrap.php';
$auth = $container['auth'];
$chats = $container['chats'];
$images = $container['images'];
$client = $container['client'];
$config = $container['config'];
$auth->requireAuth();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    JsonResponse::error('Method not allowed.', 405);
}

$auth->verifyCsrf();

$prompt = trim(isset($_POST['prompt']) ? (string) $_POST['prompt'] : '');
$chatId = trim(isset($_POST['chat_id']) ? (string) $_POST['chat_id'] : '');
$ratio = trim(isset($_POST['ratio']) ? (string) $_POST['ratio'] : '');

if ($prompt === '') {
    JsonResponse::error('Введите запрос.', 422);
}

try {
    $imageSize = selectedImageSize($config, $ratio);
    $uploadMetas = isset($_FILES['references']) ? $images->saveUploads($_FILES['references']) : [];
    $galleryMetas = [];

    foreach (postedStringList('gallery_refs') as $referencePath) {
        $galleryMetas[] = $images->metaFromRelativePath($referencePath);
    }

    if ($chatId === '') {
        $chat = $chats->create($prompt);
        $chatId = $chat['id'];
    } elseif ($chats->get($chatId) === null) {
        JsonResponse::error('Чат не найден.', 404);
    }

    $references = array_merge($uploadMetas, $galleryMetas);
    $userMessage = $chats->newMessage('user', $prompt, [
        'images' => $references,
        'settings' => [
            'ratio' => $ratio !== '' ? $ratio : $config->string('image.default_ratio', 'auto'),
            'size' => $imageSize,
        ],
    ]);

    $chat = $chats->appendMessage($chatId, $userMessage);
    $dataUrls = [];

    foreach ($references as $reference) {
        $dataUrls[] = $images->dataUrlFromRelativePath($reference['path']);
    }

    $startedAt = microtime(true);
    $result = $client->generate($prompt, $dataUrls, $imageSize);
    $usage = is_array($result['usage']) ? $result['usage'] : null;
    $savedImages = $images->saveGenerated(
        $result['images'],
        $config->string('image.output_format', 'png'),
        $prompt,
        $usage
    );
    $durationMs = (int) round((microtime(true) - $startedAt) * 1000);

    if (count($savedImages) === 0) {
        throw new RuntimeException('API did not return generated images.');
    }

    $assistantMessage = $chats->newMessage('assistant', 'Сгенерировано: ' . count($savedImages) . ' за ' . formatDurationMs($durationMs), [
        'images' => $savedImages,
        'usage' => $usage,
        'api' => [
            'responseId' => $result['id'],
            'model' => $config->string('api.model', 'gpt-5.5'),
            'text' => $result['text'],
            'durationMs' => $durationMs,
            'ratio' => $ratio !== '' ? $ratio : $config->string('image.default_ratio', 'auto'),
            'size' => $imageSize,
            'usage' => $usage,
        ],
    ]);

    $chat = $chats->appendMessage($chatId, $assistantMessage);

    JsonResponse::send([
        'ok' => true,
        'chat' => $chat,
        'images' => $savedImages,
    ]);
} catch (Throwable $exception) {
    if ($chatId !== '' && $chats->get($chatId) !== null) {
        $chat = $chats->appendMessage($chatId, $chats->newMessage('assistant', $exception->getMessage(), [
            'error' => true,
        ]));

        JsonResponse::error($exception->getMessage(), 500, ['chat' => $chat]);
    }

    JsonResponse::error($exception->getMessage(), 500);
}

function selectedImageSize($config, string &$ratio): ?string
{
    if ($ratio === '') {
        $ratio = $config->string('image.default_ratio', 'auto');
    }

    $ratios = $config->arrayValue('image.ratios');

    if (!array_key_exists($ratio, $ratios)) {
        throw new RuntimeException('Неизвестная пропорция.');
    }

    $settings = $ratios[$ratio];
    $size = is_array($settings) && isset($settings['size']) ? $settings['size'] : null;

    return is_string($size) && $size !== '' ? $size : null;
}

function formatDurationMs(int $durationMs): string
{
    $totalSeconds = max(0, (int) floor($durationMs / 1000));

    return sprintf('%d:%02d', intdiv($totalSeconds, 60), $totalSeconds % 60);
}

function postedStringList(string $name): array
{
    if (!isset($_POST[$name])) {
        return [];
    }

    $values = is_array($_POST[$name]) ? $_POST[$name] : [$_POST[$name]];
    $strings = [];

    foreach ($values as $value) {
        if (is_string($value) && trim($value) !== '') {
            $strings[] = trim($value);
        }
    }

    return $strings;
}
