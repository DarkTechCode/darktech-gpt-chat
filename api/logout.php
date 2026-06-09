<?php

declare(strict_types=1);

use GptImages\JsonResponse;

$container = require __DIR__ . '/../src/bootstrap.php';
$auth = $container['auth'];
$auth->requireAuth();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    JsonResponse::error('Method not allowed.', 405);
}

$auth->verifyCsrf();
$auth->logout();

JsonResponse::send(['ok' => true]);
