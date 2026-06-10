<?php

declare(strict_types=1);

$container = require __DIR__ . '/src/bootstrap.php';
$auth = $container['auth'];
$config = $container['config'];
$authenticated = $auth->isAuthenticated();
$ratios = $config->arrayValue('image.ratios', [
    'auto' => ['label' => 'Авто', 'size' => null],
]);
$defaultRatio = $config->string('image.default_ratio', 'auto');

if (!array_key_exists($defaultRatio, $ratios)) {
    $defaultRatio = 'auto';
}

$tokenMultiplier = $config->floatValue('usage.token_multiplier', 4.0);

if ($tokenMultiplier <= 0.0) {
    $tokenMultiplier = 4.0;
}

function h(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

$boot = [
    'authenticated' => $authenticated,
    'csrfToken' => $authenticated ? $auth->csrfToken() : '',
    'maxUploadBytes' => $config->integer('image.max_upload_bytes', 10485760),
    'model' => $config->string('api.model', 'gpt-5.5'),
    'imageFormat' => $config->string('image.output_format', 'png'),
    'tokenMultiplier' => $tokenMultiplier,
    'tokenConfigured' => $config->string('api.token') !== 'sk-...',
];
?>
<!doctype html>
<html lang="ru">

<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>GPT Chat</title>
    <link rel="stylesheet" href="assets/app.css">
    <link rel="stylesheet" href="assets/app-ui.css">
    <meta name="author" content="Dark Wizard">
</head>

<body>
    <script>
        window.GPT_CHAT_APP = <?= json_encode($boot, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES); ?>;
    </script>

    <?php if (!$authenticated): ?>
        <main class="login-shell">
            <form class="login-card" data-login-form>
                <div>
                    <p class="eyebrow">Private</p>
                    <h1>GPT Chat</h1>
                </div>
                <label class="field">
                    <span>Пароль</span>
                    <input type="password" name="password" autocomplete="current-password" required autofocus>
                </label>
                <button type="submit" class="primary-button">Войти</button>
                <p class="form-error" data-login-error hidden></p>
            </form>
        </main>
    <?php else: ?>
        <div class="app-shell" data-app-shell>
            <aside class="sidebar">
                <header class="sidebar-head">
                    <strong>GPT Chat</strong>
                    <button type="button" class="ghost-button new-chat-button" data-new-chat>+ новый чат</button>
                </header>
                <nav class="chat-list" data-chat-list></nav>
                <footer class="sidebar-foot">
                    <span>
                        <?= h($config->string('api.model', 'gpt-5.5')); ?><br>
                        <small data-global-usage>все чаты: нет данных</small>
                    </span>
                    <button type="button" class="ghost-button" data-logout>Выйти</button>
                </footer>
            </aside>

            <main class="chat-panel">
                <header class="topbar">
                    <div>
                        <p class="eyebrow">Responses API</p>
                        <h1 data-chat-title>Новый чат</h1>
                        <p class="token-summary" data-chat-usage>токены: нет данных</p>
                    </div>
                    <div class="topbar-actions">
                        <button type="button" class="ghost-button mode-button" data-image-mode aria-pressed="false">Картинки</button>
                        <span class="status-pill" data-status>Готов</span>
                    </div>
                </header>

                <?php if (!$boot['tokenConfigured']): ?>
                    <div class="config-warning">В config.php нужно указать api.token.</div>
                <?php endif; ?>

                <section class="messages" data-messages></section>

                <form class="composer" data-composer enctype="multipart/form-data">
                    <input type="hidden" name="mode" value="chat" data-mode>
                    <div class="refs-tray" data-refs-tray hidden></div>
                    <textarea name="prompt" data-prompt rows="3" placeholder="Напишите сообщение..." required></textarea>
                    <div class="quick-controls" data-image-controls hidden>
                        <input type="file" data-ref-input name="references[]" accept="image/png,image/jpeg,image/webp" multiple hidden>
                        <button type="button" class="ghost-button ref-button" data-attach>+ референс</button>
                        <fieldset class="ratio-picker" aria-label="Пропорции изображения">
                            <?php foreach ($ratios as $key => $settings): ?>
                                <?php
                                $label = is_array($settings) && isset($settings['label']) ? (string) $settings['label'] : (string) $key;
                                ?>
                                <label class="ratio-option">
                                    <input
                                        type="radio"
                                        name="ratio"
                                        value="<?= h((string) $key); ?>"
                                        <?= (string) $key === $defaultRatio ? 'checked' : ''; ?>>
                                    <span><?= h($label); ?></span>
                                </label>
                            <?php endforeach; ?>
                        </fieldset>
                    </div>
                    <div class="composer-actions">
                        <button type="submit" class="primary-button" data-send>Отправить</button>
                    </div>
                </form>
            </main>

            <aside class="gallery-panel">
                <header class="gallery-head">
                    <div>
                        <p class="eyebrow">img</p>
                        <h2>Галерея</h2>
                    </div>
                    <button type="button" class="icon-button" data-refresh-gallery title="Обновить">↻</button>
                </header>
                <div class="gallery-grid" data-gallery></div>
            </aside>
        </div>

        <div class="modal" data-modal hidden>
            <div class="modal-backdrop" data-close-modal></div>
            <section class="modal-card">
                <header>
                    <div>
                        <h2 data-modal-title></h2>
                        <p data-modal-meta></p>
                    </div>
                    <button type="button" class="ghost-button" data-close-modal>Закрыть</button>
                </header>
                <img data-modal-image alt="">
                <footer>
                    <button type="button" class="ghost-button" data-open-chat hidden>Открыть чат</button>
                    <button type="button" class="ghost-button" data-modal-reference>В референсы</button>
                    <button type="button" class="ghost-button" data-copy-link>Скопировать ссылку</button>
                    <a class="primary-button" data-download download>Сохранить</a>
                    <a class="ghost-button" data-open-image target="_blank" rel="noopener">Открыть</a>
                </footer>
            </section>
        </div>
    <?php endif; ?>

    <script src="assets/timer.js"></script>
    <script src="assets/usage.js"></script>
    <script src="assets/refs.js"></script>
    <script src="assets/draft.js"></script>
    <script src="assets/errors.js"></script>
    <script src="assets/app.js"></script>
</body>

</html>
