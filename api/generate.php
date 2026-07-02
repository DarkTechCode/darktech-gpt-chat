<?php

declare(strict_types=1);

use GptImages\ChatRepository;
use GptImages\Config;
use GptImages\ImageStorage;
use GptImages\JsonResponse;
use GptImages\NeurogateClient;

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
session_write_close();

$action = requestAction();
$prompt = trim(isset($_POST['prompt']) ? (string) $_POST['prompt'] : '');
$chatId = trim(isset($_POST['chat_id']) ? (string) $_POST['chat_id'] : '');
$mode = $action === 'regenerate_image' ? 'image' : requestMode();
$ratio = trim(isset($_POST['ratio']) ? (string) $_POST['ratio'] : '');
$imageCount = selectedImageCount();
$requestLogged = false;

try {
    if ($action === 'regenerate_image') {
        handleImageRegenerationRequest($chats, $images, $client, $config, $chatId);
    }

    if ($prompt === '') {
        JsonResponse::error('Введите запрос.', 422);
    }

    if ($mode === 'image') {
        handleImageRequest($chats, $images, $client, $config, $prompt, $chatId, $ratio, $imageCount, $requestLogged);
    }

    handleChatRequest($chats, $client, $config, $prompt, $chatId, $requestLogged);
} catch (Throwable $exception) {
    $details = exceptionDetails($exception, $mode);
    $chat = appendErrorMessage($chats, $chatId, $prompt, $mode, $requestLogged, $exception);

    if ($chat !== null) {
        JsonResponse::error($exception->getMessage(), errorStatus($exception), ['chat' => $chat, 'errorDetails' => $details]);
    }

    JsonResponse::error($exception->getMessage(), errorStatus($exception), ['errorDetails' => $details]);
}

function handleChatRequest(
    ChatRepository $chats,
    NeurogateClient $client,
    Config $config,
    string $prompt,
    string &$chatId,
    bool &$requestLogged
): void {
    if (hasPostedReferences()) {
        throw new RuntimeException('Референсы доступны только в режиме картинок.');
    }

    $chat = ensureChat($chats, $chatId, $prompt);
    $chat = $chats->appendMessage($chatId, $chats->newMessage('user', $prompt, [
        'mode' => 'chat',
    ]));
    $requestLogged = true;

    $startedAt = microtime(true);
    $result = $client->chat(textChatMessages($chat['messages']));
    $text = trim((string) $result['text']);
    $usage = is_array($result['usage']) ? $result['usage'] : null;
    $durationMs = (int) round((microtime(true) - $startedAt) * 1000);

    if ($text === '') {
        throw new RuntimeException('API did not return text.');
    }

    $chat = $chats->appendMessage($chatId, $chats->newMessage('assistant', $text, [
        'mode' => 'chat',
        'usage' => $usage,
        'api' => [
            'responseId' => $result['id'],
            'model' => $config->string('api.model', 'gpt-5.5'),
            'durationMs' => $durationMs,
            'usage' => $usage,
        ],
    ]));

    JsonResponse::send([
        'ok' => true,
        'chat' => $chat,
    ]);
}

function handleImageRequest(
    ChatRepository $chats,
    ImageStorage $images,
    NeurogateClient $client,
    Config $config,
    string $prompt,
    string &$chatId,
    string &$ratio,
    int $imageCount,
    bool &$requestLogged
): void {
    $imageSize = selectedImageSize($config, $ratio);
    $uploadMetas = isset($_FILES['references']) ? $images->saveUploads($_FILES['references']) : [];
    $galleryMetas = [];

    foreach (postedStringList('gallery_refs') as $referencePath) {
        $galleryMetas[] = $images->metaFromRelativePath($referencePath);
    }

    ensureChat($chats, $chatId, $prompt);

    $references = array_merge($uploadMetas, $galleryMetas);
    $userMessage = $chats->newMessage('user', $prompt, [
        'mode' => 'image',
        'images' => $references,
        'settings' => [
            'ratio' => $ratio,
            'size' => $imageSize,
            'imageCount' => $imageCount,
        ],
    ]);
    $chat = $chats->appendMessage($chatId, $userMessage);
    $requestLogged = true;

    $response = generateImageVariant(
        $chats,
        $images,
        $client,
        $config,
        $prompt,
        referenceDataUrls($images, $references),
        $imageSize,
        $ratio,
        $imageCount
    );
    $variant = $response['variant'];

    $assistantMessage = $chats->newMessage('assistant', (string) $variant['content'], [
        'mode' => 'image',
        'images' => $variant['images'],
        'usage' => $variant['usage'] ?? null,
        'api' => $variant['api'],
        'variants' => [$variant],
        'activeVariantId' => $variant['id'],
        'request' => [
            'messageId' => $userMessage['id'],
        ],
    ]);

    $chat = $chats->appendMessage($chatId, $assistantMessage);

    JsonResponse::send([
        'ok' => true,
        'chat' => $chat,
        'images' => $response['images'],
    ]);
}

function handleImageRegenerationRequest(
    ChatRepository $chats,
    ImageStorage $images,
    NeurogateClient $client,
    Config $config,
    string $chatId
): void {
    $messageId = trim(isset($_POST['message_id']) ? (string) $_POST['message_id'] : '');

    if ($chatId === '' || $messageId === '') {
        throw new RuntimeException('Сообщение генерации не найдено.');
    }

    $context = $chats->imageGenerationContext($chatId, $messageId);
    $prompt = (string) $context['prompt'];
    $references = isset($context['references']) && is_array($context['references']) ? $context['references'] : [];
    $ratio = isset($context['ratio']) && is_string($context['ratio']) ? $context['ratio'] : '';
    $imageCount = isset($context['imageCount']) && is_int($context['imageCount']) ? $context['imageCount'] : 1;
    $imageSize = isset($context['size']) && is_string($context['size']) && $context['size'] !== ''
        ? $context['size']
        : null;
    $response = generateImageVariant(
        $chats,
        $images,
        $client,
        $config,
        $prompt,
        referenceDataUrls($images, $references),
        $imageSize,
        $ratio,
        $imageCount
    );

    $chat = $chats->appendMessageVariant($chatId, $messageId, $response['variant']);

    JsonResponse::send([
        'ok' => true,
        'chat' => $chat,
        'images' => $response['images'],
    ]);
}

function generateImageVariant(
    ChatRepository $chats,
    ImageStorage $images,
    NeurogateClient $client,
    Config $config,
    string $prompt,
    array $dataUrls,
    ?string $imageSize,
    string $ratio,
    int $imageCount
): array {
    $startedAt = microtime(true);
    $savedImages = [];
    $usage = null;
    $responseIds = [];
    $texts = [];
    $parallelRequestLimit = imageParallelRequestLimit($config, $imageCount);

    while (count($savedImages) < $imageCount) {
        $requestCount = min($parallelRequestLimit, $imageCount - count($savedImages));
        $results = $client->generateMany($prompt, $dataUrls, $imageSize, $requestCount);

        foreach ($results as $result) {
            if (count($savedImages) >= $imageCount) {
                break;
            }

            $resultUsage = is_array($result['usage']) ? $result['usage'] : null;
            $remaining = $imageCount - count($savedImages);
            $resultImages = array_slice($result['images'], 0, $remaining);

            if (count($resultImages) === 0) {
                throw new RuntimeException('API did not return generated images.');
            }

            $savedImages = array_merge($savedImages, $images->saveGenerated(
                $resultImages,
                $config->string('image.output_format', 'png'),
                $prompt,
                $resultUsage
            ));
            $usage = addUsageTotals($usage, $resultUsage);

            if ($result['id'] !== null) {
                $responseIds[] = $result['id'];
            }

            if (is_string($result['text']) && trim($result['text']) !== '') {
                $texts[] = $result['text'];
            }
        }
    }

    $durationMs = (int) round((microtime(true) - $startedAt) * 1000);

    if (count($savedImages) === 0) {
        throw new RuntimeException('API did not return generated images.');
    }

    return [
        'variant' => $chats->newVariant('Сгенерировано: ' . count($savedImages) . ' за ' . formatDurationMs($durationMs), [
            'images' => $savedImages,
            'usage' => $usage,
            'api' => [
                'responseId' => isset($responseIds[0]) ? $responseIds[0] : null,
                'responseIds' => $responseIds,
                'model' => $config->string('api.model', 'gpt-5.5'),
                'text' => isset($texts[0]) ? $texts[0] : '',
                'texts' => $texts,
                'durationMs' => $durationMs,
                'ratio' => $ratio,
                'size' => $imageSize,
                'imageCount' => $imageCount,
                'parallelRequestLimit' => $parallelRequestLimit,
                'usage' => $usage,
            ],
        ]),
        'images' => $savedImages,
    ];
}

function referenceDataUrls(ImageStorage $images, array $references): array
{
    $dataUrls = [];

    foreach ($references as $reference) {
        if (is_array($reference) && isset($reference['path']) && is_string($reference['path'])) {
            $dataUrls[] = $images->dataUrlFromRelativePath($reference['path']);
        }
    }

    return $dataUrls;
}

function addUsageTotals(?array $total, ?array $usage): ?array
{
    if ($usage === null) {
        return $total;
    }

    if ($total === null) {
        return $usage;
    }

    foreach (['inputTokens', 'input_tokens', 'prompt_tokens', 'outputTokens', 'output_tokens', 'completion_tokens', 'totalTokens', 'total_tokens'] as $key) {
        if (!isset($usage[$key]) || !is_numeric($usage[$key])) {
            continue;
        }

        $total[$key] = (isset($total[$key]) && is_numeric($total[$key]) ? (int) $total[$key] : 0) + (int) $usage[$key];
    }

    return $total;
}

function ensureChat(ChatRepository $chats, string &$chatId, string $title): array
{
    if ($chatId === '') {
        $chat = $chats->create($title);
        $chatId = $chat['id'];

        return $chat;
    }

    $chat = $chats->get($chatId);

    if ($chat === null) {
        throw new RuntimeException('Чат не найден.');
    }

    return $chat;
}

function appendErrorMessage(
    ChatRepository $chats,
    string &$chatId,
    string $prompt,
    string $mode,
    bool $requestLogged,
    Throwable $exception
): ?array {
    if ($prompt === '') {
        return null;
    }

    if ($chatId === '') {
        $chat = $chats->create($prompt);
        $chatId = $chat['id'];
    } else {
        $chat = $chats->get($chatId);

        if ($chat === null) {
            return null;
        }
    }

    if (!$requestLogged) {
        $chat = $chats->appendMessage($chatId, $chats->newMessage('user', $prompt, [
            'mode' => $mode,
        ]));
    }

    $details = exceptionDetails($exception, $mode);

    return $chats->appendMessage($chatId, $chats->newMessage('assistant', 'Ошибка: ' . $exception->getMessage(), [
        'mode' => $mode,
        'error' => true,
        'errorDetails' => $details,
    ]));
}

function exceptionDetails(Throwable $exception, string $mode): array
{
    return [
        'message' => $exception->getMessage(),
        'type' => get_class($exception),
        'mode' => $mode,
        'occurredAt' => gmdate('c'),
        'file' => basename($exception->getFile()),
        'line' => $exception->getLine(),
        'trace' => exceptionTrace($exception),
    ];
}

function exceptionTrace(Throwable $exception): array
{
    $trace = [];

    foreach (array_slice($exception->getTrace(), 0, 6) as $frame) {
        $location = isset($frame['file']) ? basename((string) $frame['file']) : '[internal]';

        if (isset($frame['line'])) {
            $location .= ':' . (int) $frame['line'];
        }

        $call = '';

        if (isset($frame['class'])) {
            $call .= (string) $frame['class'];
        }

        if (isset($frame['type'])) {
            $call .= (string) $frame['type'];
        }

        if (isset($frame['function'])) {
            $call .= (string) $frame['function'] . '()';
        }

        $trace[] = trim($location . ' ' . $call);
    }

    return $trace;
}

function errorStatus(Throwable $exception): int
{
    $message = $exception->getMessage();

    if (
        strpos($message, 'Референсы доступны') !== false
        || strpos($message, 'Неизвестная пропорция') !== false
        || strpos($message, 'Неизвестное количество картинок') !== false
        || strpos($message, 'Текст генерации') !== false
    ) {
        return 422;
    }

    if (
        strpos($message, 'Чат не найден') !== false
        || strpos($message, 'Сообщение генерации') !== false
        || strpos($message, 'Исходный запрос генерации') !== false
        || strpos($message, 'Вариант генерации') !== false
    ) {
        return 404;
    }

    if (strpos($message, 'API ') === 0 || strpos($message, 'API request failed') === 0) {
        return 502;
    }

    return 500;
}

function textChatMessages(array $messages): array
{
    $chatMessages = [];

    foreach ($messages as $message) {
        if (!is_array($message) || ($message['mode'] ?? '') !== 'chat' || !empty($message['error'])) {
            continue;
        }

        $content = isset($message['content']) ? trim((string) $message['content']) : '';

        if ($content === '') {
            continue;
        }

        $chatMessages[] = [
            'role' => ($message['role'] ?? '') === 'assistant' ? 'assistant' : 'user',
            'content' => $content,
        ];
    }

    return $chatMessages;
}

function requestAction(): string
{
    $action = trim(isset($_POST['action']) ? (string) $_POST['action'] : 'generate');

    if ($action === '') {
        return 'generate';
    }

    if ($action !== 'generate' && $action !== 'regenerate_image') {
        JsonResponse::error('Неизвестное действие.', 422);
    }

    return $action;
}

function requestMode(): string
{
    $mode = trim(isset($_POST['mode']) ? (string) $_POST['mode'] : 'chat');

    if ($mode === '') {
        return 'chat';
    }

    if ($mode !== 'chat' && $mode !== 'image') {
        JsonResponse::error('Неизвестный режим.', 422);
    }

    return $mode;
}

function hasPostedReferences(): bool
{
    if (count(postedStringList('gallery_refs')) > 0) {
        return true;
    }

    if (!isset($_FILES['references']) || !is_array($_FILES['references'])) {
        return false;
    }

    $errors = $_FILES['references']['error'] ?? [];
    $errors = is_array($errors) ? $errors : [$errors];

    foreach ($errors as $error) {
        if ((int) $error !== UPLOAD_ERR_NO_FILE) {
            return true;
        }
    }

    return false;
}

function selectedImageSize(Config $config, string &$ratio): ?string
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

function selectedImageCount(): int
{
    $count = isset($_POST['image_count']) ? (int) $_POST['image_count'] : 1;

    if ($count < 1 || $count > 10) {
        throw new RuntimeException('Неизвестное количество картинок.');
    }

    return $count;
}

function imageParallelRequestLimit(Config $config, int $imageCount): int
{
    $limit = $config->integer('image.max_parallel_requests', 4);

    return min($imageCount, max(1, $limit));
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
