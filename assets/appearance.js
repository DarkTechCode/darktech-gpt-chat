(function () {
    const key = 'darktech-gpt.appearance';
    const defaults = {
        theme: 'dark',
        fontSize: 14,
        sliderDuration: 0,
    };
    const limits = {
        fontSize: { min: 12, max: 20 },
        sliderDuration: { min: 0, max: 1000 },
    };
    let settings = normalize(load());
    let mediaQuery = null;

    apply(settings);
    bindSystemTheme();

    document.addEventListener('DOMContentLoaded', function () {
        document.querySelectorAll('[data-theme-toggle]').forEach(function (button) {
            button.addEventListener('click', toggleTheme);
        });

        renderThemeToggles();
    });

    window.ChatAppearance = {
        current: function () {
            return Object.assign({}, settings);
        },
        defaults: function () {
            return Object.assign({}, defaults);
        },
        save: function (next) {
            settings = normalize(Object.assign({}, settings, next || {}));
            persist(settings);
            apply(settings);
            renderThemeToggles();

            return this.current();
        },
        reset: function () {
            settings = Object.assign({}, defaults);
            persist(settings);
            apply(settings);
            renderThemeToggles();

            return this.current();
        },
        toggleTheme: function () {
            settings.theme = resolveTheme(settings.theme) === 'light' ? 'dark' : 'light';
            persist(settings);
            apply(settings);
            renderThemeToggles();

            return this.current();
        },
    };

    function load() {
        try {
            return JSON.parse(localStorage.getItem(key) || '{}');
        } catch (_exception) {
            return {};
        }
    }

    function persist(value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch (_exception) {
            // Appearance preferences are optional.
        }
    }

    function normalize(value) {
        return {
            theme: normalizeTheme(value.theme),
            fontSize: boundedNumber(value.fontSize, defaults.fontSize, limits.fontSize.min, limits.fontSize.max),
            sliderDuration: boundedNumber(value.sliderDuration, defaults.sliderDuration, limits.sliderDuration.min, limits.sliderDuration.max),
        };
    }

    function normalizeTheme(value) {
        return ['dark', 'light', 'system'].indexOf(value) === -1 ? defaults.theme : value;
    }

    function boundedNumber(value, fallback, min, max) {
        const number = Number(value);

        if (!Number.isFinite(number)) {
            return fallback;
        }

        return Math.min(max, Math.max(min, Math.round(number)));
    }

    function apply(value) {
        const resolvedTheme = resolveTheme(value.theme);
        document.documentElement.dataset.theme = resolvedTheme;
        document.documentElement.dataset.themePreference = value.theme;
        document.documentElement.style.setProperty('--app-font-size', value.fontSize + 'px');
        document.documentElement.style.setProperty('--slider-duration', value.sliderDuration + 'ms');
    }

    function toggleTheme() {
        window.ChatAppearance.toggleTheme();
    }

    function renderThemeToggles() {
        const resolvedTheme = resolveTheme(settings.theme);
        const nextTheme = resolvedTheme === 'light' ? 'dark' : 'light';
        const label = nextTheme === 'light' ? 'Светлая тема' : 'Темная тема';
        const icon = nextTheme === 'light' ? '☀' : '☾';

        document.querySelectorAll('[data-theme-toggle]').forEach(function (button) {
            button.textContent = icon;
            button.title = label;
            button.setAttribute('aria-label', label);
            button.setAttribute('aria-pressed', resolvedTheme === 'light' ? 'true' : 'false');
        });
    }

    function resolveTheme(theme) {
        if (theme !== 'system') {
            return theme;
        }

        return systemPrefersLight() ? 'light' : 'dark';
    }

    function systemPrefersLight() {
        return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
    }

    function bindSystemTheme() {
        if (!window.matchMedia) {
            return;
        }

        mediaQuery = window.matchMedia('(prefers-color-scheme: light)');

        if (mediaQuery.addEventListener) {
            mediaQuery.addEventListener('change', handleSystemThemeChange);
            return;
        }

        if (mediaQuery.addListener) {
            mediaQuery.addListener(handleSystemThemeChange);
        }
    }

    function handleSystemThemeChange() {
        if (settings.theme === 'system') {
            apply(settings);
            renderThemeToggles();
        }
    }
}());
