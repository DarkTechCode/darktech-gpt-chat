(function () {
    const boot = window.GPT_CHAT_APP || {};

    document.addEventListener('DOMContentLoaded', function () {
        const page = $('[data-settings-page]');
        const form = $('[data-settings-form]');

        if (!page || !form) {
            return;
        }

        document.querySelectorAll('[data-open-settings]').forEach(function (button) {
            button.addEventListener('click', openSettings);
        });

        document.querySelectorAll('[data-close-settings]').forEach(function (button) {
            button.addEventListener('click', closeSettings);
        });

        document.querySelectorAll('[data-settings-nav]').forEach(function (link) {
            link.addEventListener('click', scrollToSettingsSection);
        });

        $('[data-reset-appearance]').addEventListener('click', resetAppearance);
        document.addEventListener('click', closeSettingsFromNavigation);
        form.addEventListener('submit', saveSettings);
    });

    async function openSettings(event) {
        if (event) {
            event.preventDefault();
        }

        setSettingsError('');
        showSettings();
        fillAppearance($('[data-settings-form]'));
        setActiveNav('settings-appearance');

        try {
            const data = await request('api/settings.php');
            fillSettings(data.settings || {});
        } catch (exception) {
            setSettingsError(exception.message);
        }
    }

    function closeSettings() {
        const page = $('[data-settings-page]');

        if (!page || page.hidden) {
            return;
        }

        page.hidden = true;
        setNodesHidden('[data-settings-heading]', true);
        setNodesHidden('[data-settings-action]', true);
        setNodesHidden('[data-chat-heading]', false);
        setNodesHidden('[data-chat-action]', false);
        setNodesHidden('[data-chat-region]', false);
    }

    function showSettings() {
        const page = $('[data-settings-page]');

        if (!page) {
            return;
        }

        setNodesHidden('[data-chat-region]', true);
        setNodesHidden('[data-chat-heading]', true);
        setNodesHidden('[data-chat-action]', true);
        setNodesHidden('[data-settings-heading]', false);
        setNodesHidden('[data-settings-action]', false);
        page.hidden = false;

        const content = $('.settings-content');

        if (content) {
            content.scrollTop = 0;
        }
    }

    function closeSettingsFromNavigation(event) {
        if (!isSettingsOpen()) {
            return;
        }

        if (event.target.closest('[data-new-chat], .chat-item')) {
            closeSettings();
        }
    }

    function scrollToSettingsSection(event) {
        event.preventDefault();

        const id = event.currentTarget.getAttribute('href').slice(1);
        const section = document.getElementById(id);

        if (!section) {
            return;
        }

        section.scrollIntoView({ block: 'start', behavior: 'smooth' });
        setActiveNav(id);
    }

    function setActiveNav(id) {
        document.querySelectorAll('[data-settings-nav]').forEach(function (link) {
            const active = link.getAttribute('href') === '#' + id;
            link.classList.toggle('is-active', active);
            link.setAttribute('aria-current', active ? 'true' : 'false');
        });
    }

    function setNodesHidden(selector, hidden) {
        document.querySelectorAll(selector).forEach(function (node) {
            node.hidden = hidden;
        });
    }

    function isSettingsOpen() {
        const page = $('[data-settings-page]');

        return Boolean(page && !page.hidden);
    }

    function fillSettings(settings) {
        const form = $('[data-settings-form]');
        setValue(form, 'api.baseUrl', settings.api && settings.api.baseUrl);
        setValue(form, 'api.token', '');
        setValue(form, 'api.model', settings.api && settings.api.model);
        setValue(form, 'api.timeoutSeconds', settings.api && settings.api.timeoutSeconds);
        setValue(form, 'usage.tokenMultiplier', settings.usage && settings.usage.tokenMultiplier);
        setValue(form, 'gallery.pageSize', settings.gallery && settings.gallery.pageSize);
        setValue(form, 'gallery.columns', settings.gallery && settings.gallery.columns);
        setValue(form, 'prompts.chat', settings.prompts && settings.prompts.chat);
        setValue(form, 'prompts.image', settings.prompts && settings.prompts.image);
        setValue(form, 'auth.password', '');
        field(form, 'auth.disablePassword').checked = false;
        $('[data-password-state]').textContent = settings.auth && settings.auth.passwordEnabled
            ? 'Пароль включен. Чтобы оставить его без изменений, не заполняйте поле ниже.'
            : 'Пароль отключен. Приложение открывается сразу.';
        $('[data-token-state]').textContent = settings.api && settings.api.tokenConfigured
            ? 'API ключ задан. Чтобы оставить его без изменений, не заполняйте поле выше.'
            : 'API ключ не задан.';
    }

    async function saveSettings(event) {
        event.preventDefault();
        setSettingsError('');

        const form = event.currentTarget;
        const button = $('[data-save-settings]');
        const payload = {
            api: {
                baseUrl: value(form, 'api.baseUrl'),
                token: value(form, 'api.token'),
                model: value(form, 'api.model'),
                timeoutSeconds: value(form, 'api.timeoutSeconds'),
            },
            usage: {
                tokenMultiplier: value(form, 'usage.tokenMultiplier'),
            },
            gallery: {
                pageSize: value(form, 'gallery.pageSize'),
                columns: value(form, 'gallery.columns'),
            },
            prompts: {
                chat: value(form, 'prompts.chat'),
                image: value(form, 'prompts.image'),
            },
            auth: {},
        };

        if (field(form, 'auth.disablePassword').checked) {
            payload.auth.password = '';
        } else if (value(form, 'auth.password') !== '') {
            payload.auth.password = value(form, 'auth.password');
        }

        button.disabled = true;

        try {
            await request('api/settings.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            saveAppearance(form);
            window.location.reload();
        } catch (exception) {
            setSettingsError(exception.message);
        } finally {
            button.disabled = false;
        }
    }

    function fillAppearance(form) {
        const appearance = window.ChatAppearance
            ? window.ChatAppearance.current()
            : { theme: 'dark', fontSize: 14 };
        const layout = window.ChatLayout
            ? window.ChatLayout.current()
            : { sidebar: 400, gallery: 600 };

        setValue(form, 'appearance.theme', appearance.theme);
        setValue(form, 'appearance.fontSize', appearance.fontSize);
        setValue(form, 'appearance.sidebarWidth', layout.sidebar);
        setValue(form, 'appearance.galleryWidth', layout.gallery);
    }

    function saveAppearance(form) {
        if (window.ChatAppearance) {
            window.ChatAppearance.save({
                theme: value(form, 'appearance.theme'),
                fontSize: value(form, 'appearance.fontSize'),
            });
        }

        if (window.ChatLayout) {
            window.ChatLayout.save({
                sidebar: value(form, 'appearance.sidebarWidth'),
                gallery: value(form, 'appearance.galleryWidth'),
            });
        }
    }

    function resetAppearance(event) {
        event.preventDefault();

        if (window.ChatAppearance) {
            window.ChatAppearance.reset();
        }

        if (window.ChatLayout) {
            window.ChatLayout.reset();
        }

        fillAppearance($('[data-settings-form]'));
    }

    async function request(url, options) {
        const init = options || {};
        init.credentials = 'same-origin';
        init.cache = 'no-store';
        init.headers = init.headers || {};

        if (init.method && init.method !== 'GET') {
            init.headers['X-CSRF-Token'] = boot.csrfToken;
        }

        const response = await fetch(url, init);
        const payload = await response.json().catch(function () { return {}; });

        if (!response.ok || payload.ok === false) {
            throw new Error(payload.error || 'Request failed.');
        }

        return payload;
    }

    function setSettingsError(message) {
        const node = $('[data-settings-error]');
        node.hidden = message === '';
        node.textContent = message;
    }

    function setValue(form, name, value) {
        field(form, name).value = value === undefined || value === null ? '' : String(value);
    }

    function value(form, name) {
        return field(form, name).value.trim();
    }

    function field(form, name) {
        return form.elements[name];
    }

    function $(selector) {
        return document.querySelector(selector);
    }
}());
