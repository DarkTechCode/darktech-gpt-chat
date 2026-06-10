<?php

declare(strict_types=1);

use GptImages\JsonResponse;

$container = require __DIR__ . '/../src/bootstrap.php';
$auth = $container['auth'];
$configFile = $container['configFile'];
$auth->requireAuth();

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    JsonResponse::send([
        'ok' => true,
        'settings' => $configFile->publicSettings(),
    ]);
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $auth->verifyCsrf();

    $body = file_get_contents('php://input');
    $input = json_decode((string) $body, true);

    if (!is_array($input)) {
        JsonResponse::error('Settings payload must be JSON.', 422);
    }

    try {
        JsonResponse::send([
            'ok' => true,
            'settings' => $configFile->update($input),
        ]);
    } catch (Throwable $exception) {
        JsonResponse::error($exception->getMessage(), 422);
    }
}

JsonResponse::error('Method not allowed.', 405);
