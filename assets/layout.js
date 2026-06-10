(function () {
    const key = 'darktech-gpt.layout';
    const limits = {
        sidebar: { min: 260, max: 1920, fallback: 400 },
        gallery: { min: 320, max: 2460, fallback: 600 },
        chatMin: 360,
    };
    let settings = load();

    window.ChatLayout = {
        current: function () {
            return {
                sidebar: currentWidth('sidebar'),
                gallery: currentWidth('gallery'),
            };
        },
        defaults: function () {
            return defaultSettings();
        },
        limits: function () {
            return {
                sidebar: Object.assign({}, limits.sidebar),
                gallery: Object.assign({}, limits.gallery),
            };
        },
        save: function (next) {
            settings.sidebar = numeric(next && next.sidebar, limits.sidebar.fallback);
            settings.gallery = numeric(next && next.gallery, limits.gallery.fallback);
            applyToShell();
            save();

            return this.current();
        },
        reset: function () {
            settings = defaultSettings();
            applyToShell();
            save();

            return this.current();
        },
    };

    document.addEventListener('DOMContentLoaded', function () {
        const shell = $('[data-app-shell]');

        if (!shell) {
            return;
        }

        apply(shell);
        observeShell(shell);
        bind(shell, $('[data-resize-sidebar]'), 'sidebar');
        bind(shell, $('[data-resize-gallery]'), 'gallery');
        window.addEventListener('resize', function () { apply(shell); });
    });

    function bind(shell, handle, side) {
        if (!handle) {
            return;
        }

        handle.addEventListener('pointerdown', function (event) {
            if (!canResize(shell, side)) {
                return;
            }

            event.preventDefault();
            handle.setPointerCapture(event.pointerId);
            handle.classList.add('is-dragging');
            document.body.classList.add('is-resizing');

            const startX = event.clientX;
            const startWidth = currentWidth(side);

            function move(moveEvent) {
                const delta = moveEvent.clientX - startX;
                const raw = side === 'sidebar' ? startWidth + delta : startWidth - delta;
                settings[side] = constrained(shell, side, raw);
                apply(shell);
            }

            function up(upEvent) {
                handle.releasePointerCapture(upEvent.pointerId);
                handle.classList.remove('is-dragging');
                document.body.classList.remove('is-resizing');
                handle.removeEventListener('pointermove', move);
                handle.removeEventListener('pointerup', up);
                handle.removeEventListener('pointercancel', up);
                save();
            }

            handle.addEventListener('pointermove', move);
            handle.addEventListener('pointerup', up);
            handle.addEventListener('pointercancel', up);
        });
    }

    function apply(shell) {
        settings.sidebar = constrained(shell, 'sidebar', settings.sidebar);
        settings.gallery = constrained(shell, 'gallery', settings.gallery);
        shell.style.setProperty('--sidebar-width', settings.sidebar + 'px');
        shell.style.setProperty('--gallery-width', settings.gallery + 'px');
    }

    function applyToShell() {
        const shell = $('[data-app-shell]');

        if (shell) {
            apply(shell);
        }
    }

    function constrained(shell, side, value) {
        const maxByViewport = availableMax(shell, side);
        const max = Math.max(limits[side].min, Math.min(limits[side].max, maxByViewport));

        return clamp(Number(value) || limits[side].fallback, limits[side].min, max);
    }

    function availableMax(shell, side) {
        const handleWidth = 12;
        const rect = shell.getBoundingClientRect();
        const otherWidth = side === 'sidebar'
            ? (shell.classList.contains('is-image-mode') ? currentWidth('gallery') : 0)
            : currentWidth('sidebar');

        return rect.width - otherWidth - limits.chatMin - handleWidth;
    }

    function observeShell(shell) {
        const observer = new MutationObserver(function () {
            apply(shell);
        });

        observer.observe(shell, { attributes: true, attributeFilter: ['class'] });
    }

    function canResize(shell, side) {
        if (window.matchMedia('(max-width: 1050px)').matches) {
            return false;
        }

        return side !== 'gallery' || shell.classList.contains('is-image-mode');
    }

    function currentWidth(side) {
        return Number(settings[side]) || limits[side].fallback;
    }

    function load() {
        try {
            const parsed = JSON.parse(localStorage.getItem(key) || '{}');

            return {
                sidebar: numeric(parsed.sidebar, limits.sidebar.fallback),
                gallery: numeric(parsed.gallery, limits.gallery.fallback),
            };
        } catch (_exception) {
            return defaultSettings();
        }
    }

    function defaultSettings() {
        return {
            sidebar: limits.sidebar.fallback,
            gallery: limits.gallery.fallback,
        };
    }

    function save() {
        try {
            localStorage.setItem(key, JSON.stringify(settings));
        } catch (_exception) {
            // Layout preferences are optional.
        }
    }

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    function numeric(value, fallback) {
        const number = Number(value);

        return Number.isFinite(number) && number > 0 ? Math.round(number) : fallback;
    }

    function $(selector) {
        return document.querySelector(selector);
    }
}());
