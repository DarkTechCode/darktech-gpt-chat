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
    $action = isset($_POST['action']) ? (string) $_POST['action'] : 'create';

    if ($action === 'rename') {
        $id = isset($_POST['id']) ? trim((string) $_POST['id']) : '';
        $title = isset($_POST['title']) ? trim((string) $_POST['title']) : '';

        if ($id === '') {
            JsonResponse::error('Чат не найден.', 422);
        }

        if ($title === '') {
            JsonResponse::error('Введите название чата.', 422);
        }

        try {
            JsonResponse::send(['ok' => true, 'chat' => $chats->rename($id, $title)]);
        } catch (Throwable $exception) {
            JsonResponse::error($exception->getMessage(), 404);
        }
    }

    $title = isset($_POST['title']) ? (string) $_POST['title'] : 'Новый чат';

    JsonResponse::send(['ok' => true, 'chat' => $chats->create($title)]);
}

JsonResponse::error('Method not allowed.', 405);
