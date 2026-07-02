<?php

declare(strict_types=1);

use GptImages\Auth;
use GptImages\ChatRepository;
use GptImages\Config;
use GptImages\ConfigFile;
use GptImages\ImageStorage;
use GptImages\NeurogateClient;
use GptImages\ResponseImageExtractor;
use GptImages\ResponsesTransport;

require_once __DIR__ . '/Config.php';
require_once __DIR__ . '/ConfigFile.php';
require_once __DIR__ . '/JsonResponse.php';
require_once __DIR__ . '/Auth.php';
require_once __DIR__ . '/ImageMessageVariants.php';
require_once __DIR__ . '/ChatRepository.php';
require_once __DIR__ . '/ImageStorage.php';
require_once __DIR__ . '/ResponseImageExtractor.php';
require_once __DIR__ . '/ResponsesTransport.php';
require_once __DIR__ . '/NeurogateClient.php';

$config = Config::load(__DIR__ . '/../config.php');
$auth = new Auth($config);
$auth->start();

$imageStorage = new ImageStorage(
    $config->string('storage.img_dir'),
    $config->string('storage.img_url', 'img'),
    $config->integer('image.max_upload_bytes', 10485760)
);

return [
    'config' => $config,
    'configFile' => new ConfigFile(__DIR__ . '/../config.php'),
    'auth' => $auth,
    'chats' => new ChatRepository($config->string('storage.data_dir')),
    'images' => $imageStorage,
    'client' => new NeurogateClient($config, new ResponseImageExtractor(), new ResponsesTransport($config)),
];
