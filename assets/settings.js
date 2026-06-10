(function () {
    const boot = window.GPT_CHAT_APP || {};

    document.addEventListener('DOMContentLoaded', function () {
        const modal = $('[data-settings-modal]');

        if (!modal) {
            return;
        }

        document.querySelectorAll('[data-open-settings]').forEach(function (button) {
            button.addEventListener('click', openSettings);
        });

        document.querySelectorAll('[data-close-settings]').forEach(function (button) {
            button.addEventListener('click', closeSettings);
        });

        $('[data-settings-form]').addEventListener('submit', saveSettings);
    });

    async function openSettings() {
        setSettingsError('');
        $('[data-settings-modal]').hidden = false;

        try {
            const data = await request('api/settings.php');
            fillSettings(data.settings || {});
        } catch (exception) {
            setSettingsError(exception.message);
        }
    }

    function closeSettings() {
        $('[data-settings-modal]').hidden = true;
    }

    function fillSettings(settings) {
        const form = $('[data-settings-form]');
        setValue(form, 'api.baseUrl', settings.api && settings.api.baseUrl);
        setValue(form, 'api.token', '');
        setValue(form, 'api.model', settings.api && settings.api.model);
        setValue(form, 'api.timeoutSeconds', settings.api && settings.api.timeoutSeconds);
        setValue(form, 'usage.tokenMultiplier', settings.usage && settings.usage.tokenMultiplier);
        setValue(form, 'gallery.pageSize', settings.gallery && settings.gallery.pageSize);
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
            window.location.reload();
        } catch (exception) {
            setSettingsError(exception.message);
        } finally {
            button.disabled = false;
        }
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
