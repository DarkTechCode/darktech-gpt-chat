<?php

declare(strict_types=1);

use GptImages\JsonResponse;

$container = require __DIR__ . '/../src/bootstrap.php';
$auth = $container['auth'];
$images = $container['images'];
$chats = $container['chats'];
$auth->requireAuth();

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    JsonResponse::error('Method not allowed.', 405);
}

JsonResponse::send([
    'ok' => true,
    'images' => $images->listImages($chats->imageContextMap()),
]);
