(function () {
    const viewKey = 'darktech-gpt.mobileView';
    const validViews = ['chats', 'chat', 'gallery'];
    const mobileQuery = window.matchMedia('(max-width: 720px)');
    const tabletQuery = window.matchMedia('(min-width: 721px) and (max-width: 1050px)');

    document.addEventListener('DOMContentLoaded', function () {
        window.ChatMobile.init();
    });

    let shell = null;
    let tabs = null;
    let toggleButtons = [];
    let closeButtons = [];
    let backdrops = [];

    window.ChatMobile = {
        init: function () {
            shell = document.querySelector('[data-app-shell]');
            tabs = document.querySelector('[data-mobile-tabs]');

            if (!shell || !tabs) {
                return;
            }

            toggleButtons = Array.from(document.querySelectorAll('[data-toggle-gallery]'));
            closeButtons = Array.from(document.querySelectorAll('[data-close-gallery]'));
            backdrops = Array.from(document.querySelectorAll('.gallery-backdrop'));

            tabs.querySelectorAll('[data-mobile-tab]').forEach(function (tab) {
                tab.addEventListener('click', function () {
                    window.ChatMobile.setView(tab.dataset.mobileTab);
                });
            });

            toggleButtons.forEach(function (button) {
                button.addEventListener('click', function () { window.ChatMobile.toggleGallery(); });
            });

            closeButtons.forEach(function (button) {
                button.addEventListener('click', function () { window.ChatMobile.closeGallery(); });
            });

            backdrops.forEach(function (backdrop) {
                backdrop.addEventListener('click', function () { window.ChatMobile.closeGallery(); });
            });

            const stored = storedView();
            if (mobileQuery.matches && stored && stored !== shell.dataset.view) {
                shell.dataset.view = stored;
            }

            syncControls();
            syncTabs();

            if (mobileQuery.addEventListener) {
                mobileQuery.addEventListener('change', syncControls);
                tabletQuery.addEventListener('change', function () { window.ChatMobile.closeGallery(); });
            } else if (mobileQuery.addListener) {
                mobileQuery.addListener(syncControls);
            }
        },

        setView: function (name) {
            if (!shell || validViews.indexOf(name) === -1 || !mobileQuery.matches) {
                return;
            }

            shell.dataset.view = name;
            storeView(name);
            syncTabs();
        },

        openGallery: function () {
            if (!shell || !tabletQuery.matches) {
                return;
            }

            shell.classList.add('is-gallery-open');
        },

        closeGallery: function () {
            if (!shell) {
                return;
            }

            shell.classList.remove('is-gallery-open');
        },

        toggleGallery: function () {
            if (!shell) {
                return;
            }

            shell.classList.toggle('is-gallery-open');
        },
    };

    function syncControls() {
        const isMobile = mobileQuery.matches;
        const isTablet = tabletQuery.matches;

        if (tabs) { tabs.hidden = !isMobile; }
        toggleButtons.forEach(function (button) { button.hidden = !isTablet; });
        closeButtons.forEach(function (button) { button.hidden = !isTablet; });

        /* Backdrop скрывается атрибутом на десктопе/мобиле; на планшете
           CSS анимирует opacity/pointer-events через класс is-gallery-open. */
        backdrops.forEach(function (backdrop) { backdrop.hidden = !isTablet; });

        if (!isTablet && shell) {
            window.ChatMobile.closeGallery();
        }

        syncTabs();
    }

    function syncTabs() {
        if (!tabs || !shell) {
            return;
        }

        const current = shell.dataset.view || 'chat';

        tabs.querySelectorAll('[data-mobile-tab]').forEach(function (tab) {
            tab.classList.toggle('is-active', tab.dataset.mobileTab === current);
        });
    }

    function storedView() {
        try {
            const value = localStorage.getItem(viewKey);
            return validViews.indexOf(value) === -1 ? null : value;
        } catch (_exception) {
            return null;
        }
    }

    function storeView(value) {
        try {
            localStorage.setItem(viewKey, value);
        } catch (_exception) {
            // View preference is optional.
        }
    }
}());
