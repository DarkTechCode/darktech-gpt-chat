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

$galleryPageSize = $config->integer('gallery.page_size', 36);

if ($galleryPageSize <= 0) {
    $galleryPageSize = 36;
}

$galleryPageSize = min($galleryPageSize, 200);

$galleryColumns = $config->integer('gallery.columns', 4);

if ($galleryColumns <= 0) {
    $galleryColumns = 4;
}

$galleryColumns = min($galleryColumns, 12);

function h(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

$projectName = 'DarkTech GPT Chat';
$projectVersion = 'v1.0.0';
$projectUrl = 'https://darktech.ru';

$boot = [
    'authenticated' => $authenticated,
    'authEnabled' => $auth->isEnabled(),
    'csrfToken' => $authenticated ? $auth->csrfToken() : '',
    'maxUploadBytes' => $config->integer('image.max_upload_bytes', 10485760),
    'model' => $config->string('api.model', 'gpt-5.5'),
    'imageFormat' => $config->string('image.output_format', 'png'),
    'tokenMultiplier' => $tokenMultiplier,
    'galleryPageSize' => $galleryPageSize,
    'galleryColumns' => $galleryColumns,
    'tokenConfigured' => $config->string('api.token') !== '' && $config->string('api.token') !== 'sk-...',
];
?>
<!doctype html>
<html lang="ru">

<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title><?= h($projectName); ?></title>
    <link rel="stylesheet" href="assets/vendor/prism/prism-tomorrow.min.css">
    <link rel="stylesheet" href="assets/vendor/prism/prism-line-numbers.min.css">
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
                    <h1><?= h($projectName); ?></h1>
                    <a class="brand-version" href="<?= h($projectUrl); ?>" target="_blank" rel="noopener"><?= h($projectVersion); ?></a>
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
        <div class="app-shell" style="--gallery-columns: <?= h((string) $galleryColumns); ?>;" data-app-shell>
            <aside class="sidebar">
                <header class="sidebar-head">
                    <div class="brand-block">
                        <strong><?= h($projectName); ?></strong>
                        <a class="brand-version" href="<?= h($projectUrl); ?>" target="_blank" rel="noopener"><?= h($projectVersion); ?></a>
                    </div>
                    <button type="button" class="ghost-button new-chat-button" data-new-chat>+ новый чат</button>
                </header>
                <nav class="chat-list" data-chat-list></nav>
                <footer class="sidebar-foot">
                    <span>
                        <?= h($config->string('api.model', 'gpt-5.5')); ?><br>
                        <small data-global-usage>все чаты: нет данных</small>
                    </span>
                    <div class="sidebar-actions">
                        <button type="button" class="ghost-button" data-open-settings>Настройки</button>
                        <?php if ($auth->isEnabled()): ?>
                            <button type="button" class="ghost-button" data-logout>Выйти</button>
                        <?php endif; ?>
                    </div>
                </footer>
            </aside>

            <div class="resize-handle resize-handle-sidebar" data-resize-sidebar title="Изменить ширину списка чатов"></div>

            <main class="chat-panel">
                <header class="topbar">
                    <div>
                        <p class="eyebrow">Responses API</p>
                        <div class="title-row">
                            <h1 data-chat-title>Новый чат</h1>
                            <button type="button" class="icon-button rename-chat-button" data-rename-chat title="Переименовать чат" aria-label="Переименовать чат">✎</button>
                        </div>
                        <p class="token-summary" data-chat-usage>токены: нет данных</p>
                    </div>
                    <div class="topbar-actions">
                        <button type="button" class="ghost-button" data-open-settings>Настройки</button>
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

            <div class="resize-handle resize-handle-gallery" data-resize-gallery title="Изменить ширину галереи"></div>

            <aside class="gallery-panel">
                <header class="gallery-head">
                    <div>
                        <p class="eyebrow">img</p>
                        <h2>Галерея</h2>
                    </div>
                    <button type="button" class="icon-button" data-refresh-gallery title="Обновить">↻</button>
                </header>
                <div class="gallery-grid" data-gallery></div>
                <footer class="gallery-more" data-gallery-more hidden>
                    <button type="button" class="ghost-button" data-load-gallery-more>Загрузить ещё</button>
                </footer>
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

        <div class="modal" data-settings-modal hidden>
            <div class="modal-backdrop" data-close-settings></div>
            <section class="modal-card settings-card">
                <header>
                    <div>
                        <h2>Настройки</h2>
                        <p>config.php</p>
                    </div>
                    <button type="button" class="ghost-button" data-close-settings>Закрыть</button>
                </header>
                <form class="settings-form" data-settings-form>
                    <section class="settings-section">
                        <h3>API</h3>
                        <label class="field">
                            <span>API URL</span>
                            <input type="url" name="api.baseUrl" required>
                        </label>
                        <label class="field">
                            <span>API ключ</span>
                            <input type="password" name="api.token" autocomplete="off" placeholder="Оставьте пустым, чтобы не менять">
                        </label>
                        <p class="settings-note" data-token-state></p>
                        <label class="field">
                            <span>Модель</span>
                            <input type="text" name="api.model" required>
                        </label>
                        <label class="field">
                            <span>Таймаут, секунд</span>
                            <input type="number" name="api.timeoutSeconds" min="1" step="1" required>
                        </label>
                        <label class="field">
                            <span>Коэффициент токенов</span>
                            <input type="number" name="usage.tokenMultiplier" min="0.01" step="0.01" required>
                        </label>
                    </section>

                    <section class="settings-section">
                        <h3>Галерея</h3>
                        <label class="field">
                            <span>Картинок за раз</span>
                            <input type="number" name="gallery.pageSize" min="1" max="200" step="1" required>
                        </label>
                        <label class="field">
                            <span>Картинок в ряд</span>
                            <input type="number" name="gallery.columns" min="1" max="12" step="1" required>
                        </label>
                    </section>

                    <section class="settings-section">
                        <h3>Промпты</h3>
                        <label class="field">
                            <span>Обычный чат</span>
                            <textarea name="prompts.chat" rows="5" required></textarea>
                        </label>
                        <label class="field">
                            <span>Картинки</span>
                            <textarea name="prompts.image" rows="5" required></textarea>
                        </label>
                    </section>

                    <section class="settings-section">
                        <h3>Вход</h3>
                        <p class="settings-note" data-password-state></p>
                        <label class="field">
                            <span>Новый пароль</span>
                            <input type="password" name="auth.password" autocomplete="new-password" placeholder="Оставьте пустым, чтобы не менять">
                        </label>
                        <label class="check-field">
                            <input type="checkbox" name="auth.disablePassword" value="1">
                            <span>Отключить пароль для входа</span>
                        </label>
                    </section>

                    <p class="form-error" data-settings-error hidden></p>
                    <footer>
                        <button type="button" class="ghost-button" data-close-settings>Отмена</button>
                        <button type="submit" class="primary-button" data-save-settings>Сохранить</button>
                    </footer>
                </form>
            </section>
        </div>
    <?php endif; ?>

    <script src="assets/vendor/marked/marked.min.js"></script>
    <script src="assets/vendor/dompurify.min.js"></script>
    <script>
        window.Prism = window.Prism || {};
        window.Prism.manual = true;
    </script>
    <script src="assets/vendor/prism/prism.min.js"></script>
    <script src="assets/vendor/prism/prism-markup.min.js"></script>
    <script src="assets/vendor/prism/prism-markup-templating.min.js"></script>
    <script src="assets/vendor/prism/prism-clike.min.js"></script>
    <script src="assets/vendor/prism/prism-php.min.js"></script>
    <script src="assets/vendor/prism/prism-javascript.min.js"></script>
    <script src="assets/vendor/prism/prism-css.min.js"></script>
    <script src="assets/vendor/prism/prism-json.min.js"></script>
    <script src="assets/vendor/prism/prism-bash.min.js"></script>
    <script src="assets/vendor/prism/prism-line-numbers.min.js"></script>
    <script src="assets/timer.js"></script>
    <script src="assets/usage.js"></script>
    <script src="assets/refs.js"></script>
    <script src="assets/draft.js"></script>
    <script src="assets/errors.js"></script>
    <script src="assets/markdown.js"></script>
    <script src="assets/app.js"></script>
    <script src="assets/settings.js"></script>
    <script src="assets/layout.js"></script>
</body>

</html>
