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
$projectVersion = 'v2.0.0';
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
    <script>
        (function () {
            var defaults = { theme: 'dark', fontSize: 14 };
            var settings = {};

            try {
                settings = JSON.parse(localStorage.getItem('darktech-gpt.appearance') || '{}');
            } catch (_exception) {
                settings = {};
            }

            var theme = ['dark', 'light', 'system'].indexOf(settings.theme) === -1
                ? defaults.theme
                : settings.theme;
            var fontSize = Number(settings.fontSize) || defaults.fontSize;
            var sliderDuration = Number(settings.sliderDuration);
            sliderDuration = Number.isFinite(sliderDuration) && sliderDuration >= 0
                ? Math.min(1000, Math.round(sliderDuration))
                : 0;
            var resolvedTheme = theme === 'system' && window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches
                ? 'light'
                : theme === 'system' ? 'dark' : theme;

            document.documentElement.dataset.theme = resolvedTheme;
            document.documentElement.dataset.themePreference = theme;
            document.documentElement.style.setProperty('--app-font-size', Math.min(20, Math.max(12, Math.round(fontSize))) + 'px');
            document.documentElement.style.setProperty('--slider-duration', sliderDuration + 'ms');
        }());
    </script>
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
        <nav class="mobile-tabs" data-mobile-tabs hidden>
            <button type="button" class="mobile-tab" data-mobile-tab="chats">Чаты</button>
            <button type="button" class="mobile-tab is-active" data-mobile-tab="chat">Чат</button>
            <button type="button" class="mobile-tab" data-mobile-tab="gallery">Галерея</button>
        </nav>

        <div class="app-shell" style="--gallery-columns: <?= h((string) $galleryColumns); ?>;" data-app-shell data-view="chat">
            <aside class="sidebar">
                <header class="sidebar-head">
                    <div class="brand-block">
                        <strong><?= h($projectName); ?></strong>
                        <a class="brand-version" href="<?= h($projectUrl); ?>" target="_blank" rel="noopener"><?= h($projectVersion); ?></a>
                    </div>
                    <div class="sidebar-head-actions">
                        <button type="button" class="icon-button chat-search-toggle" data-toggle-chat-search title="Поиск по чатам" aria-label="Поиск по чатам" aria-pressed="false">🔍</button>
                        <button type="button" class="ghost-button new-chat-button" data-new-chat>+ новый чат</button>
                    </div>
                </header>
                <div class="chat-search-panel" data-chat-search-panel hidden>
                    <input type="text" class="chat-search-input" data-chat-search-input placeholder="Поиск по чатам..." autocomplete="off">
                    <div class="chat-filters" role="group" aria-label="Фильтр чатов">
                        <button type="button" class="chat-filter is-active" data-chat-filter="all">Все</button>
                        <button type="button" class="chat-filter" data-chat-filter="text">Текст</button>
                        <button type="button" class="chat-filter" data-chat-filter="images">Картинки</button>
                    </div>
                </div>
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
                    <div data-chat-heading>
                        <p class="eyebrow">Responses API</p>
                        <div class="title-row">
                            <h1 data-chat-title>Новый чат</h1>
                            <button type="button" class="icon-button rename-chat-button" data-rename-chat title="Переименовать чат" aria-label="Переименовать чат">✎</button>
                        </div>
                        <p class="token-summary" data-chat-usage>токены: нет данных</p>
                    </div>
                    <div data-settings-heading hidden>
                        <p class="eyebrow">config.php</p>
                        <div class="title-row">
                            <h1>Настройки</h1>
                        </div>
                        <p class="token-summary">Параметры приложения</p>
                    </div>
                    <div class="topbar-actions">
                        <button type="button" class="icon-button theme-toggle-button" data-chat-action data-theme-toggle title="Светлая тема" aria-label="Светлая тема">☀</button>
                        <button type="button" class="icon-button gallery-toggle-button" data-toggle-gallery title="Галерея" aria-label="Галерея" hidden>▦</button>
                        <button type="button" class="ghost-button" data-chat-action data-open-settings>Настройки</button>
                        <button type="button" class="ghost-button" data-settings-action data-close-settings hidden>К чату</button>
                        <button type="button" class="ghost-button mode-button" data-chat-action data-image-mode aria-pressed="false">Картинки</button>
                        <span class="status-pill" data-chat-action data-status>Готов</span>
                    </div>
                </header>

                <?php if (!$boot['tokenConfigured']): ?>
                    <div class="config-warning" data-chat-region>В config.php нужно указать api.token.</div>
                <?php endif; ?>

                <section class="settings-page" data-settings-page hidden>
                    <nav class="settings-nav" aria-label="Разделы настроек">
                        <a href="#settings-appearance" data-settings-nav>Оформление</a>
                        <a href="#settings-api" data-settings-nav>API</a>
                        <a href="#settings-prompts" data-settings-nav>Промпты</a>
                        <a href="#settings-auth" data-settings-nav>Вход</a>
                    </nav>
                    <div class="settings-content">
                        <form class="settings-form" data-settings-form>
                            <section class="settings-section" id="settings-appearance">
                                <h3>Оформление</h3>
                                <label class="field">
                                    <span>Тема</span>
                                    <select name="appearance.theme">
                                        <option value="dark">Темная</option>
                                        <option value="light">Светлая</option>
                                        <option value="system">Системная</option>
                                    </select>
                                </label>
                                <label class="field">
                                    <span>Размер шрифта, px</span>
                                    <input type="number" name="appearance.fontSize" min="12" max="20" step="1">
                                </label>
                                <div class="settings-grid">
                                    <label class="field">
                                        <span>Ширина списка чатов, px</span>
                                        <input type="number" name="appearance.sidebarWidth" min="260" max="1920">
                                    </label>
                                    <label class="field">
                                        <span>Ширина галереи, px</span>
                                        <input type="number" name="appearance.galleryWidth" min="320" max="2460">
                                    </label>
                                </div>
                                <label class="field">
                                    <span>Скорость анимации перелистывания, мс (0 — мгновенно)</span>
                                    <input type="number" name="appearance.sliderDuration" min="0" max="1000">
                                </label>
                                <button type="button" class="ghost-button settings-reset-button" data-reset-appearance>Сбросить оформление</button>

                                <h4 class="settings-subtitle">Галерея</h4>
                                <label class="field">
                                    <span>Картинок за раз</span>
                                    <input type="number" name="gallery.pageSize" min="1" max="200" step="1" required>
                                </label>
                                <label class="field">
                                    <span>Картинок в ряд</span>
                                    <input type="number" name="gallery.columns" min="1" max="12" step="1" required>
                                </label>
                            </section>

                            <section class="settings-section" id="settings-api">
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

                            <section class="settings-section" id="settings-prompts">
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

                            <section class="settings-section" id="settings-auth">
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
                    </div>
                </section>

                <section class="messages" data-chat-region data-messages></section>

                <form class="composer" data-chat-region data-composer enctype="multipart/form-data">
                    <input type="hidden" name="mode" value="chat" data-mode>
                    <div class="refs-tray" data-refs-tray hidden></div>
                    <textarea name="prompt" data-prompt rows="3" placeholder="Напишите сообщение..." required></textarea>
                    <div class="quick-controls" data-image-controls hidden>
                        <input type="file" data-ref-input name="references[]" accept="image/png,image/jpeg,image/webp" multiple hidden>
                        <div class="image-side-controls">
                            <button type="button" class="ghost-button ref-button" data-attach>+ референс</button>
                            <label class="image-count-field">
                                <span>Картинок</span>
                                <select name="image_count" data-image-count>
                                    <?php for ($imageCount = 1; $imageCount <= 10; $imageCount++): ?>
                                        <option value="<?= h((string) $imageCount); ?>"><?= h((string) $imageCount); ?></option>
                                    <?php endfor; ?>
                                </select>
                            </label>
                        </div>
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

            <div class="gallery-backdrop" data-close-gallery hidden></div>

            <aside class="gallery-panel">
                <header class="gallery-head">
                    <div>
                        <p class="eyebrow">img</p>
                        <h2>Галерея</h2>
                    </div>
                    <div class="gallery-head-actions">
                        <button type="button" class="icon-button" data-refresh-gallery title="Обновить">↻</button>
                        <button type="button" class="icon-button gallery-close-button" data-close-gallery title="Закрыть" aria-label="Закрыть" hidden>✕</button>
                    </div>
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
                <button type="button" class="icon-button modal-close-button" data-close-modal title="Закрыть" aria-label="Закрыть">✕</button>
                <header>
                    <div>
                        <h2 data-modal-title></h2>
                        <p data-modal-meta></p>
                    </div>
                </header>
                <div class="modal-slider-wrap" data-modal-slider>
                    <div class="modal-slider-track" data-modal-track></div>
                    <button type="button" class="icon-button modal-nav modal-prev" data-modal-prev title="Предыдущее изображение" aria-label="Предыдущее изображение">‹</button>
                    <button type="button" class="icon-button modal-nav modal-next" data-modal-next title="Следующее изображение" aria-label="Следующее изображение">›</button>
                </div>
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
    <script src="assets/appearance.js"></script>
    <script src="assets/app.js"></script>
    <script src="assets/settings.js"></script>
    <script src="assets/layout.js"></script>
    <script src="assets/mobile.js"></script>
</body>

</html>
