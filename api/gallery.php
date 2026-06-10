<?php

declare(strict_types=1);

use GptImages\JsonResponse;

$container = require __DIR__ . '/../src/bootstrap.php';
$auth = $container['auth'];
$config = $container['config'];
$images = $container['images'];
$chats = $container['chats'];
$auth->requireAuth();

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    JsonResponse::error('Method not allowed.', 405);
}

$defaultLimit = $config->integer('gallery.page_size', 36);
$defaultLimit = $defaultLimit > 0 ? $defaultLimit : 36;
$limit = galleryQueryInteger('limit', $defaultLimit);
$offset = galleryQueryInteger('offset', 0);

if ($limit <= 0) {
    JsonResponse::error('Gallery limit must be a positive integer.', 422);
}

if ($offset < 0) {
    JsonResponse::error('Gallery offset must be zero or a positive integer.', 422);
}

$limit = min($limit, 200);
$page = $images->listImagePage($chats->imageContextMap(), $offset, $limit);
$count = count($page['images']);
$nextOffset = $offset + $count;
$hasMore = $nextOffset < $page['total'];

JsonResponse::send([
    'ok' => true,
    'images' => $page['images'],
    'pagination' => [
        'offset' => $offset,
        'limit' => $limit,
        'count' => $count,
        'total' => $page['total'],
        'hasMore' => $hasMore,
        'nextOffset' => $hasMore ? $nextOffset : null,
    ],
]);

function galleryQueryInteger(string $key, int $default): int
{
    $value = $_GET[$key] ?? null;

    if ($value === null || $value === '') {
        return $default;
    }

    if (is_array($value) || preg_match('/^-?\d+$/', (string) $value) !== 1) {
        JsonResponse::error('Gallery ' . $key . ' must be an integer.', 422);
    }

    return (int) $value;
}
