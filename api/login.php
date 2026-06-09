<?php

declare(strict_types=1);

use GptImages\JsonResponse;

$container = require __DIR__ . '/../src/bootstrap.php';
$auth = $container['auth'];

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    JsonResponse::error('Method not allowed.', 405);
}

$password = isset($_POST['password']) ? (string) $_POST['password'] : '';

if (!$auth->login($password)) {
    JsonResponse::error('Неверный пароль.', 403);
}

JsonResponse::send([
    'ok' => true,
    'csrfToken' => $auth->csrfToken(),
]);
