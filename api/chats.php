<?php

declare(strict_types=1);

use GptImages\JsonResponse;

$container = require __DIR__ . '/../src/bootstrap.php';
$auth = $container['auth'];
$chats = $container['chats'];
$auth->requireAuth();

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $id = isset($_GET['id']) ? (string) $_GET['id'] : '';

    if ($id !== '') {
        $chat = $chats->get($id);

        if ($chat === null) {
            JsonResponse::error('Чат не найден.', 404);
        }

        JsonResponse::send(['ok' => true, 'chat' => $chat]);
    }

    JsonResponse::send([
        'ok' => true,
        'chats' => $chats->summaries(),
        'usage' => $chats->totals(),
    ]);
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $auth->verifyCsrf();
    $title = isset($_POST['title']) ? (string) $_POST['title'] : 'Новый чат';

    JsonResponse::send(['ok' => true, 'chat' => $chats->create($title)]);
}

JsonResponse::error('Method not allowed.', 405);
