<?php

declare(strict_types=1);

return [
    'auth' => [
        'password' => 'neurogate',
        'password_hash' => null,
        'session_name' => 'gpt_images_session',
    ],

    'api' => [
        'base_url' => 'https://api.neurogate.space/v1',
        'token' => 'sk-...',
        'model' => 'gpt-5.5',
        'timeout_seconds' => 300,
        'stream' => true,
        'force_image_tool' => true,
        'store' => false,
    ],

    'usage' => [
        'token_multiplier' => 4,
    ],

    'image' => [
        'output_format' => 'png',
        'size' => null,
        'default_ratio' => 'auto',
        'ratios' => [
            'auto' => ['label' => 'Авто', 'size' => null],
            '1:1' => ['label' => '1:1', 'size' => '1024x1024'],
            '3:4' => ['label' => '3:4', 'size' => '1152x1536'],
            '9:16' => ['label' => '9:16', 'size' => '864x1536'],
            '4:3' => ['label' => '4:3', 'size' => '1536x1152'],
            '16:9' => ['label' => '16:9', 'size' => '1536x864'],
        ],
        'quality' => null,
        'background' => null,
        'max_upload_bytes' => 10485760,
    ],

    'prompts' => [
        'system' => 'You are an image generation assistant. Use image_generation to create or edit images requested by the user. Return image results without adding readable text unless the user asks for text.',
    ],

    'storage' => [
        'data_dir' => __DIR__ . '/data',
        'img_dir' => __DIR__ . '/img',
        'img_url' => 'img',
    ],
];
