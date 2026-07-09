(function () {
    const boot = window.GPT_CHAT_APP || {};
    const state = {
        chats: [],
        activeChat: null,
        gallery: [],
        galleryRefs: [],
        galleryPagination: {
            offset: 0,
            limit: Number(boot.galleryPageSize) || 36,
            count: 0,
            total: 0,
            hasMore: false,
            nextOffset: null,
        },
        galleryLoadingMore: false,
        usage: null,
        mode: 'chat',
        pending: {},
        pendingTickId: null,
        localMessages: {},
        imageIndexes: {},
        modal: {
            images: [],
            index: 0,
        },
        search: {
            open: false,
            query: '',
            filter: 'all',
        },
    };

    document.addEventListener('DOMContentLoaded', function () {
        const loginForm = document.querySelector('[data-login-form]');

        if (loginForm) {
            loginForm.addEventListener('submit', login);
            return;
        }

        if (boot.authenticated) {
            bindApp();
            loadAll();
        }
    });

    async function login(event) {
        event.preventDefault();
        const form = event.currentTarget;
        const error = document.querySelector('[data-login-error]');

        try {
            await request('api/login.php', { method: 'POST', body: new FormData(form) });
            window.location.reload();
        } catch (exception) {
            error.hidden = false;
            error.textContent = exception.message;
        }
    }

    function bindApp() {
        $('[data-new-chat]').addEventListener('click', createChatFromButton);
        if ($('[data-logout]')) { $('[data-logout]').addEventListener('click', logout); }
        $('[data-composer]').addEventListener('submit', generate);
        $('[data-rename-chat]').addEventListener('click', renameActiveChat);
        $('[data-image-mode]').addEventListener('click', toggleImageMode);
        window.PromptDraft.bind($('[data-prompt]'));
        $('[data-attach]').addEventListener('click', function () { setMode('image'); $('[data-ref-input]').click(); });
        $('[data-ref-input]').addEventListener('change', handleRefsChange);
        window.ReferenceDrop.bind($('[data-composer]'), $('[data-ref-input]'), handleRefsChange, rejectRefs);
        $('[data-refresh-gallery]').addEventListener('click', refreshGallery);
        $('[data-load-gallery-more]').addEventListener('click', loadMoreGallery);
        document.querySelectorAll('[data-close-modal]').forEach(function (node) {
            node.addEventListener('click', closeModal);
        });
        $('[data-modal-prev]').addEventListener('click', function () { stepModalImage(-1); });
        $('[data-modal-next]').addEventListener('click', function () { stepModalImage(1); });
        bindModalSwipe();
        document.addEventListener('keydown', handleModalKeys);
        $('[data-copy-link]').addEventListener('click', copyModalLink);
        $('[data-open-chat]').addEventListener('click', openModalChat);
        $('[data-modal-reference]').addEventListener('click', addModalReference);
        bindChatSearch();
        renderMode();
    }

    function bindChatSearch() {
        const toggle = $('[data-toggle-chat-search]');
        const panel = $('[data-chat-search-panel]');
        const input = $('[data-chat-search-input]');

        toggle.addEventListener('click', function () {
            setChatSearchOpen(!state.search.open);
            if (state.search.open) {
                input.focus();
            }
        });

        input.addEventListener('input', function () {
            state.search.query = input.value.trim().toLowerCase();
            renderSidebar();
        });

        document.querySelectorAll('[data-chat-filter]').forEach(function (button) {
            button.addEventListener('click', function () {
                setChatFilter(button.dataset.chatFilter);
            });
        });
    }

    function setChatSearchOpen(open) {
        state.search.open = open;
        const panel = $('[data-chat-search-panel]');
        const toggle = $('[data-toggle-chat-search]');

        panel.hidden = !open;
        toggle.classList.toggle('is-active', open);
        toggle.setAttribute('aria-pressed', open ? 'true' : 'false');

        if (!open) {
            const input = $('[data-chat-search-input]');
            if (input) {
                input.value = '';
            }
            state.search.query = '';
            setChatFilter('all');
        }

        renderSidebar();
    }

    function setChatFilter(filter) {
        state.search.filter = filter;

        document.querySelectorAll('[data-chat-filter]').forEach(function (button) {
            button.classList.toggle('is-active', button.dataset.chatFilter === filter);
        });

        renderSidebar();
    }

    async function loadAll() {
        try {
            await loadChats();
        } catch (exception) {
            appendClientError('Не удалось загрузить чаты.', exception);
        }

        await refreshGallery();
    }

    async function loadChats(preferredId) {
        await loadChatSummaries();

        const activeId = preferredId || (state.activeChat && state.activeChat.id) || (state.chats[0] && state.chats[0].id);

        if (activeId) {
            await openChat(activeId);
        } else {
            state.activeChat = null;
            renderChat();
        }
    }

    async function loadChatSummaries() {
        const data = await request('api/chats.php');
        state.chats = data.chats || [];
        state.usage = data.usage || null;
        renderSidebar();
    }

    async function createChatFromButton() {
        const chat = await createChat();

        if (chat) {
            if (window.ChatMobile) { window.ChatMobile.setView('chat'); }
            focusPrompt();
        }
    }

    async function openChat(chatId) {
        const data = await request('api/chats.php?id=' + encodeURIComponent(chatId));
        state.activeChat = data.chat;
        appendLocalMessages(chatId);
        renderSidebar();
        renderChat();
        if (window.ChatMobile) { window.ChatMobile.setView('chat'); }
    }

    function appendLocalMessages(chatId) {
        if (!state.activeChat || !state.localMessages[chatId] || state.localMessages[chatId].length === 0) {
            return;
        }

        state.activeChat.messages = state.activeChat.messages.concat(state.localMessages[chatId]);
        delete state.localMessages[chatId];
    }

    async function createChat(resetMode) {
        try {
            if (resetMode !== false) {
                setMode('chat');
            }
            const form = new FormData();
            form.append('title', 'Новый чат');
            const data = await request('api/chats.php', { method: 'POST', body: form });
            state.activeChat = data.chat;
            await loadChatSummaries();
            renderChat();

            return data.chat;
        } catch (exception) {
            appendClientError('Не удалось создать чат.', exception);
            return null;
        }
    }

    async function logout() {
        const form = new FormData();
        await request('api/logout.php', { method: 'POST', body: form });
        window.location.reload();
    }

    async function generate(event) {
        event.preventDefault();
        const composer = event.currentTarget;
        const form = new FormData(composer);
        const prompt = String(form.get('prompt') || '').trim();

        if (!prompt) { return; }

        const requestMode = state.mode;
        const requestChat = state.activeChat || await createChat(false);

        if (!requestChat) { return; }

        if (isChatPending(requestChat.id)) {
            setStatus('Этот чат уже ждет ответ.');
            return;
        }

        const requestRefs = state.galleryRefs.slice();
        const requestImageSettings = requestMode === 'image' ? pendingImageSettings(form) : null;
        const optimisticMessage = requestMode === 'image'
            ? pendingImageMessage(prompt, requestRefs, Array.from($('[data-ref-input]').files || []), requestImageSettings)
            : null;

        form.set('mode', requestMode);
        form.append('chat_id', requestChat.id);

        if (requestMode === 'image') {
            requestRefs.forEach(function (path) { form.append('gallery_refs[]', path); });
        }

        startChatPending(requestChat.id, requestMode, optimisticMessage);
        composer.reset();
        window.PromptDraft.clear();
        state.galleryRefs = [];
        renderRefs();
        renderMode();

        try {
            const data = await request('api/generate.php', { method: 'POST', body: form });

            if (state.activeChat && state.activeChat.id === data.chat.id) {
                state.activeChat = data.chat;
                appendLocalMessages(data.chat.id);
                renderChat();
            }

            await loadChatSummaries();
            if (requestMode === 'image') { await loadGallery(0, false); }
        } catch (exception) {
            if (exception.payload && exception.payload.chat) {
                if (state.activeChat && state.activeChat.id === exception.payload.chat.id) {
                    state.activeChat = exception.payload.chat;
                    appendLocalMessages(exception.payload.chat.id);
                    renderChat();
                }

                await loadChatSummaries();
            } else {
                appendClientError('Не удалось получить ответ.', exception, prompt, requestChat.id, requestMode);
            }
        } finally {
            finishChatPending(requestChat.id);
        }
    }

    async function loadGallery(offset, append) {
        const galleryOffset = offset === undefined ? 0 : offset;
        const params = new URLSearchParams();
        params.set('offset', String(galleryOffset));

        if (append) {
            params.set('limit', String(state.galleryPagination.limit || 36));
        }

        const data = await request('api/gallery.php?' + params.toString());
        const images = data.images || [];
        state.gallery = append ? state.gallery.concat(images) : images;
        state.galleryPagination = normalizeGalleryPagination(data.pagination, galleryOffset, images.length);
        renderGallery();
    }

    async function loadMoreGallery() {
        const pagination = state.galleryPagination;

        if (!pagination.hasMore || pagination.nextOffset === null || state.galleryLoadingMore) {
            return;
        }

        state.galleryLoadingMore = true;
        renderGalleryMore();

        try {
            await loadGallery(pagination.nextOffset, true);
        } catch (exception) {
            appendClientError('Не удалось загрузить ещё картинки.', exception);
        } finally {
            state.galleryLoadingMore = false;
            renderGalleryMore();
        }
    }

    async function refreshGallery() {
        try {
            await loadGallery(0, false);
        } catch (exception) {
            appendClientError('Не удалось загрузить галерею.', exception);
        }
    }

    function matchesChatSearch(chat) {
        if (state.search.filter === 'images' && !chat.imageCount) {
            return false;
        }

        if (state.search.filter === 'text' && chat.imageCount) {
            return false;
        }

        if (!state.search.query) {
            return true;
        }

        const haystack = ((chat.title || '') + ' ' + (chat.preview || '')).toLowerCase();

        return haystack.indexOf(state.search.query) !== -1;
    }

    function renderSidebar() {
        const list = $('[data-chat-list]');
        list.innerHTML = '';
        $('[data-global-usage]').textContent = 'все чаты: ' + window.UsageFormatter.short(state.usage);

        const visible = state.chats.filter(matchesChatSearch);

        if (state.search.open && (state.search.query || state.search.filter !== 'all') && visible.length === 0) {
            list.append(child('p', 'Ничего не найдено', 'chat-list-empty'));
            return;
        }

        visible.forEach(function (chat) {
            const pending = state.pending[chat.id] || null;
            const item = document.createElement('button');
            item.type = 'button';
            item.dataset.chatId = chat.id;
            item.className = 'chat-item'
                + (state.activeChat && state.activeChat.id === chat.id ? ' is-active' : '')
                + (pending ? ' is-pending' : '');
            item.addEventListener('click', function () {
                openChat(chat.id).catch(function (exception) {
                    appendClientError('Не удалось открыть чат.', exception);
                });
            });
            item.append(child('strong', chat.title));
            item.append(child('span', chat.preview || ''));
            if (pending) {
                const pendingNode = child('span', sidebarPendingLabel(pending), 'chat-pending-time');
                pendingNode.setAttribute('data-chat-pending-time', '');
                item.append(pendingNode);
            }
            item.append(child('span', window.UsageFormatter.short(chat.usage), 'chat-usage'));
            list.append(item);
        });
    }

    function renderChat(scrollToEnd) {
        const title = $('[data-chat-title]');
        const messages = $('[data-messages]');
        const previousScrollTop = messages.scrollTop;
        messages.innerHTML = '';
        title.textContent = state.activeChat ? state.activeChat.title : 'Новый чат';
        $('[data-chat-usage]').textContent = state.activeChat ? window.UsageFormatter.full(state.activeChat.usage) : 'токены: нет данных';
        $('[data-rename-chat]').disabled = !state.activeChat;
        window.PromptDraft.setChat(state.activeChat ? state.activeChat.id : null);
        renderBusyState();

        if (!state.activeChat) {
            messages.append(child('div', 'Новый чат', 'empty-state'));
            return;
        }

        const chatMessages = messagesWithPending(state.activeChat);

        if (chatMessages.length === 0) {
            messages.append(child('div', 'Новый чат', 'empty-state'));
            return;
        }

        chatMessages.forEach(function (message) {
            const view = messageView(message);
            const displayImages = messageImagesForDisplay(message, view);
            const imageIndex = activeImageIndex(message, view);
            preloadVariantImages(message, view);
            const article = document.createElement('article');
            article.dataset.messageId = message.id || '';
            article.className = 'message ' + message.role
                + (message.error ? ' is-error' : '')
                + (message.pending ? ' is-pending-message' : '');
            article.append(child('div', messageHeadText(message, view), 'message-head'));
            article.append(messageBubble(message, view));
            const imageRequestDetails = pendingImageRequestDetails(message);
            if (imageRequestDetails) { article.append(imageRequestDetails); }
            if (message.errorDetails) { article.append(window.ChatErrors.panel(message.errorDetails)); }

            if (displayImages.length) {
                article.append(imageStrip(displayImages, message.role, state.activeChat.id, view.images, imageIndex));
            }
            if (canRegenerateImage(message)) {
                const variantControls = imageVariantControls(message);
                if (variantControls) { article.append(variantControls); }
            }

            messages.append(article);
        });

        if (scrollToEnd !== false) {
            scrollMessagesToBottom();
        } else {
            messages.scrollTop = previousScrollTop;
        }
    }

    function messageBubble(message, view) {
        const bubble = document.createElement('div');
        bubble.className = 'bubble';
        const content = view ? view.content : message.content;

        if (message.role === 'assistant' && window.ChatMarkdown) {
            window.ChatMarkdown.render(bubble, content || '');
            if (canRegenerateImage(message)) {
                bubble.classList.add('has-regenerate');
                bubble.append(regenerateButton(message));
            }
            if (canRetry(message)) {
                bubble.classList.add('has-retry');
                bubble.append(retryButton(message));
            }
            return bubble;
        }

        bubble.textContent = content || '';

        return bubble;
    }

    function messageHeadText(message, view) {
        const parts = [roleName(message.role)];
        const date = formatDate(view.createdAt);

        if (date !== '') {
            parts.push(date);
        }

        if (message.pending) {
            parts.push('генерируется');
        }

        return parts.join(' · ');
    }

    function imageStrip(images, role, chatId, modalImages, modalStartIndex) {
        const strip = document.createElement('div');
        const contextImages = Array.isArray(modalImages) && modalImages.length > 0 ? modalImages : images;
        const startIndex = modalStartIndex === undefined ? 0 : modalStartIndex;
        strip.className = 'image-strip';

        if (role === 'assistant') { strip.classList.add('image-strip-large'); }

        images.forEach(function (image, index) {
            strip.append(imageCard(image, role === 'assistant' && image.kind === 'generated', chatId, undefined, contextImages, startIndex + index));
        });
        return strip;
    }

    function messagesWithPending(chat) {
        const messages = Array.isArray(chat.messages) ? chat.messages.slice() : [];
        const pending = state.pending[chat.id] || null;

        if (pending && pending.message && !persistedPendingRequestExists(pending, messages)) {
            messages.push(pending.message);
        }

        return messages;
    }

    function persistedPendingRequestExists(pending, messages) {
        const content = pending.message && pending.message.content ? pending.message.content : '';

        if (content === '') {
            return false;
        }

        return messages.some(function (message) {
            if (!message || message.role !== 'user' || message.mode !== pending.mode || message.content !== content) {
                return false;
            }

            const createdAt = Date.parse(message.createdAt || '');

            return Number.isFinite(createdAt) && createdAt >= pending.startedAt - 10000;
        });
    }

    function pendingImageSettings(form) {
        const count = Math.min(10, Math.max(1, parseInt(String(form.get('image_count') || '1'), 10) || 1));
        const checkedRatio = document.querySelector('input[name="ratio"]:checked');
        const ratio = String(form.get('ratio') || (checkedRatio ? checkedRatio.value : '') || '').trim();
        const ratioLabelNode = checkedRatio && checkedRatio.parentElement
            ? checkedRatio.parentElement.querySelector('span')
            : null;
        const ratioLabel = ratioLabelNode && ratioLabelNode.textContent.trim() !== ''
            ? ratioLabelNode.textContent.trim()
            : ratio;

        return {
            imageCount: count,
            ratio: ratio,
            ratioLabel: ratioLabel,
        };
    }

    function pendingImageMessage(prompt, galleryRefs, files, settings) {
        const objectUrls = [];
        const images = [];

        files.forEach(function (file) {
            const url = URL.createObjectURL(file);
            objectUrls.push(url);
            images.push({
                kind: 'reference',
                file: file.name,
                path: url,
                url: url,
                width: 0,
                height: 0,
                bytes: file.size || 0,
                mime: file.type || 'image/*',
            });
        });

        galleryRefs.forEach(function (path) {
            images.push({
                kind: 'reference',
                file: fileName(path),
                path: path,
                url: path,
                width: 0,
                height: 0,
                bytes: 0,
                mime: 'image/*',
            });
        });

        return {
            id: tempId('pending_msg'),
            role: 'user',
            content: prompt,
            createdAt: new Date().toISOString(),
            mode: 'image',
            images: images,
            settings: settings || null,
            pending: true,
            objectUrls: objectUrls,
        };
    }

    function pendingImageRequestDetails(message) {
        const text = pendingImageRequestDetailsText(message);

        return text === '' ? null : child('div', text, 'message-request-settings');
    }

    function pendingImageRequestDetailsText(message) {
        if (!message || !message.pending || message.mode !== 'image') {
            return '';
        }

        const settings = message.settings && typeof message.settings === 'object' ? message.settings : {};
        const count = Math.min(10, Math.max(1, parseInt(String(settings.imageCount || '1'), 10) || 1));
        const ratio = String(settings.ratioLabel || settings.ratio || '').trim();
        const parts = ['Картинок: ' + count];

        if (ratio !== '') {
            parts.push('Пропорции: ' + ratio);
        }

        return parts.join(' · ');
    }

    function messageImagesForDisplay(message, view) {
        const images = Array.isArray(view.images) ? view.images : [];

        if (message.role !== 'assistant' || message.mode !== 'image' || images.length < 2) {
            return images;
        }

        return [images[activeImageIndex(message, view)]];
    }

    const preloadedUrls = new Set();

    /* Предзагрузка картинок всех вариантов в кэш браузера, чтобы смена
       и картинок, и вариантов стрелками была мгновенной. */
    function preloadVariantImages(message, view) {
        if (message.role !== 'assistant' || message.mode !== 'image') {
            return;
        }

        const sources = [view];
        imageVariants(message).forEach(function (variant) {
            if (variant && variant.id !== (view.variantId || '') && Array.isArray(variant.images)) {
                sources.push(variant);
            }
        });

        sources.forEach(function (source) {
            const images = Array.isArray(source.images) ? source.images : [];
            images.forEach(function (image) {
                const url = image && image.url ? image.url : '';

                if (url === '' || preloadedUrls.has(url)) {
                    return;
                }

                preloadedUrls.add(url);
                const preloader = new Image();
                preloader.src = url;
            });
        });
    }

    function messageView(message) {
        const variant = activeVariant(message);

        if (!variant) {
            return {
                content: message.content || '',
                createdAt: message.createdAt,
                images: Array.isArray(message.images) ? message.images : [],
            };
        }

        return {
            content: variant.content || '',
            createdAt: variant.createdAt || message.createdAt,
            images: Array.isArray(variant.images) ? variant.images : [],
            variantId: variant.id || '',
        };
    }

    function activeVariant(message) {
        const variants = imageVariants(message);

        if (variants.length === 0) {
            return null;
        }

        return variants[activeVariantIndex(message)] || variants[variants.length - 1];
    }

    function imageVariants(message) {
        return Array.isArray(message.variants) ? message.variants.filter(function (variant) {
            return variant && typeof variant === 'object';
        }) : [];
    }

    function activeVariantIndex(message) {
        const variants = imageVariants(message);
        const activeId = message.activeVariantId || '';
        const found = variants.findIndex(function (variant) {
            return variant.id === activeId;
        });

        return found === -1 ? Math.max(0, variants.length - 1) : found;
    }

    function canRegenerateImage(message) {
        return message.role === 'assistant' && message.mode === 'image' && !message.error;
    }

    function canRetry(message) {
        if (message.retrying) {
            return false;
        }

        return message.role === 'assistant'
            && message.error
            && !message.local
            && Boolean(message.id)
            && !isTempId(message.id);
    }

    function isTempId(id) {
        return typeof id === 'string' && id.indexOf('temp_') === 0;
    }

    function activeImageIndex(message, view) {
        const images = Array.isArray(view.images) ? view.images : [];

        if (images.length === 0) {
            return 0;
        }

        const key = imageIndexKey(message);
        const index = Number(state.imageIndexes[key]) || 0;

        return Math.min(images.length - 1, Math.max(0, index));
    }

    function setActiveImageIndex(message, index) {
        const view = messageView(message);
        const images = Array.isArray(view.images) ? view.images : [];

        if (images.length === 0) {
            return;
        }

        const newIndex = Math.min(images.length - 1, Math.max(0, index));
        state.imageIndexes[imageIndexKey(message)] = newIndex;

        /* Оптимистичное обновление: меняем <img> и подпись напрямую,
           без полного ререндера чата. Картинки предзагружены, поэтому
           смена мгновенная. Если DOM не найден — откат на renderChat. */
        if (updateActiveImageDom(message, view, newIndex)) {
            return;
        }

        renderChat(false);
    }

    function updateActiveImageDom(message, view, imageIndex) {
        const article = document.querySelector('.message[data-message-id="' + cssEscape(message.id || '') + '"]');
        const card = article ? article.querySelector('.image-strip-large .image-card-large') : null;

        if (!card) {
            return false;
        }

        const image = Array.isArray(view.images) ? view.images[imageIndex] : null;

        if (!image) {
            return false;
        }

        const img = card.querySelector('img');
        const span = card.querySelector('span');

        if (img) {
            img.alt = window.UsageFormatter.imageName(image);
            img.src = image.url;
        }

        if (span) {
            span.textContent = window.UsageFormatter.imageLabel(image);
        }

        updateImageVariantCounters(article, imageIndex, Array.isArray(view.images) ? view.images.length : 0, 'Картинка');

        return true;
    }

    function updateActiveVariantDom(message, view) {
        const article = document.querySelector('.message[data-message-id="' + cssEscape(message.id || '') + '"]');

        if (!article) {
            return false;
        }

        /* Сбрасываем индекс картинки: у каждого варианта своя нумерация. */
        state.imageIndexes[imageIndexKey(message)] = 0;

        const bubble = article.querySelector('.bubble');

        if (bubble) {
            const hasRegenerate = bubble.classList.contains('has-regenerate');
            const regenerateEl = bubble.querySelector('.regenerate-button');

            if (window.ChatMarkdown) {
                window.ChatMarkdown.render(bubble, view.content || '');
            }

            if (hasRegenerate) {
                bubble.classList.add('has-regenerate');
            }

            /* Переотрендер markdown очищает innerHTML, поэтому кнопку
               регенерации нужно вернуть заново. */
            if (hasRegenerate && message) {
                const canRegen = canRegenerateImage(message);
                const existing = bubble.querySelector('.regenerate-button');

                if (canRegen && !existing) {
                    bubble.append(regenerateButton(message));
                } else if (!canRegen && existing) {
                    existing.remove();
                }
            }
        }

        /* Обновляем счётчик «Вариант N/M» и disabled кнопок варианта. */
        const variants = imageVariants(message);
        const variantIndex = activeVariantIndex(message);
        updateImageVariantCounters(article, variantIndex, variants.length, 'Вариант');

        /* Картинка: если число картинок совпадает с текущим DOM — обновляем
           напрямую, иначе откатываемся на полный ререндер. */
        const imageCount = Array.isArray(view.images) ? view.images.length : 0;
        const domImageNav = article.querySelector('.image-variant-count[data-count="image"]');
        const domHasImageNav = Boolean(domImageNav);

        if ((imageCount > 1) !== domHasImageNav) {
            renderChat(false);
            return true;
        }

        if (imageCount > 0) {
            updateActiveImageDom(message, view, 0);
        }

        return true;
    }

    function updateImageVariantCounters(article, index, total, prefix) {
        if (!article || total <= 0) {
            return;
        }

        const label = prefix + ' ' + (index + 1) + ' / ' + total;
        const kind = prefix === 'Картинка' ? 'image' : 'variant';

        const counter = article.querySelector('.image-variant-count[data-count="' + kind + '"]');
        if (counter) {
            counter.textContent = label;
        }

        const prev = article.querySelector('.image-variant-button[data-nav="prev-' + kind + '"]');
        const next = article.querySelector('.image-variant-button[data-nav="next-' + kind + '"]');
        if (prev) { prev.disabled = index <= 0; }
        if (next) { next.disabled = index >= total - 1; }
    }

    function cssEscape(value) {
        if (window.CSS && typeof window.CSS.escape === 'function') {
            return window.CSS.escape(value);
        }

        return String(value).replace(/[^a-zA-Z0-9_-]/g, function (char) {
            return '\\' + char;
        });
    }

    function imageIndexKey(message) {
        const chatId = state.activeChat ? state.activeChat.id : '';
        const variant = activeVariant(message);
        const variantId = variant && variant.id ? variant.id : 'message';

        return chatId + ':' + (message.id || '') + ':' + variantId;
    }

    function imageVariantControls(message) {
        const controls = document.createElement('div');
        const variants = imageVariants(message);
        const activeIndex = activeVariantIndex(message);
        const view = messageView(message);
        const images = Array.isArray(view.images) ? view.images : [];
        const imageIndex = activeImageIndex(message, view);
        const pending = state.activeChat && isChatPending(state.activeChat.id);

        controls.className = 'image-variant-controls';

        if (images.length > 1) {
            const prevImage = variantButton('‹', 'Предыдущая картинка', function () {
                const current = activeImageIndex(message, messageView(message));
                setActiveImageIndex(message, current - 1);
            }, imageIndex <= 0);
            prevImage.dataset.nav = 'prev-image';
            controls.append(prevImage);
            const imageCount = child('span', 'Картинка ' + (imageIndex + 1) + ' / ' + images.length, 'image-variant-count');
            imageCount.dataset.count = 'image';
            controls.append(imageCount);
            const nextImage = variantButton('›', 'Следующая картинка', function () {
                const current = activeImageIndex(message, messageView(message));
                setActiveImageIndex(message, current + 1);
            }, imageIndex >= images.length - 1);
            nextImage.dataset.nav = 'next-image';
            controls.append(nextImage);
        }

        if (variants.length > 1) {
            const prevVariant = variantButton('‹', 'Предыдущий вариант', function () {
                const current = activeVariantIndex(message);
                activateImageVariant(message, current - 1).catch(function (exception) {
                    appendClientError('Не удалось переключить вариант.', exception);
                });
            }, pending || activeIndex <= 0);
            prevVariant.dataset.nav = 'prev-variant';
            controls.append(prevVariant);
            const variantCount = child('span', 'Вариант ' + (activeIndex + 1) + ' / ' + variants.length, 'image-variant-count');
            variantCount.dataset.count = 'variant';
            controls.append(variantCount);
            const nextVariant = variantButton('›', 'Следующий вариант', function () {
                const current = activeVariantIndex(message);
                activateImageVariant(message, current + 1).catch(function (exception) {
                    appendClientError('Не удалось переключить вариант.', exception);
                });
            }, pending || activeIndex >= variants.length - 1);
            nextVariant.dataset.nav = 'next-variant';
            controls.append(nextVariant);
        }

        if (controls.children.length === 0) {
            return null;
        }

        return controls;
    }

    function variantButton(text, title, onClick, disabled) {
        const button = child('button', text, 'icon-button image-variant-button');
        button.type = 'button';
        button.title = title;
        button.setAttribute('aria-label', title);
        button.disabled = Boolean(disabled);
        button.addEventListener('click', onClick);

        return button;
    }

    function regenerateButton(message) {
        const pending = state.activeChat && isChatPending(state.activeChat.id);
        const button = child('button', '↻', 'icon-button image-variant-button regenerate-button');
        button.type = 'button';
        button.title = 'Перегенерировать';
        button.setAttribute('aria-label', 'Перегенерировать');
        button.disabled = Boolean(pending);
        button.addEventListener('click', function () { regenerateImage(message); });

        return button;
    }

    function retryButton(message) {
        const pending = state.activeChat && isChatPending(state.activeChat.id);
        const button = child('button', '↻', 'icon-button image-variant-button retry-button');
        button.type = 'button';
        button.title = 'Повторить запрос';
        button.setAttribute('aria-label', 'Повторить запрос');
        button.disabled = Boolean(pending);
        button.addEventListener('click', function () { retryMessage(message); });

        return button;
    }

    async function activateImageVariant(message, index) {
        if (!state.activeChat) {
            return;
        }

        const variants = imageVariants(message);
        const variant = variants[index];

        if (!variant || !variant.id || variant.id === message.activeVariantId) {
            return;
        }

        /* Оптимистичное переключение: меняем активный вариант локально
           и обновляем DOM напрямую. Картинки предзагружены, поэтому
           смена мгновенная. Если DOM не найден — откат на renderChat. */
        message.activeVariantId = variant.id;
        const view = messageView(message);

        if (!updateActiveVariantDom(message, view)) {
            renderChat(false);
        }

        /* Сохранение выбора на сервер — в фоне, без блокировки UI. */
        syncVariantActivation(state.activeChat.id, message.id, variant.id);
    }

    function syncVariantActivation(chatId, messageId, variantId) {
        const form = new FormData();
        form.append('action', 'activate_variant');
        form.append('id', chatId);
        form.append('message_id', messageId);
        form.append('variant_id', variantId);

        request('api/chats.php', { method: 'POST', body: form }).then(function () {
            loadChatSummaries();
        }).catch(function () {
            /* Фоновая синхронизация не критична: выбор сохранится
               при следующем действии или перезагрузке. */
        });
    }

    async function regenerateImage(message) {
        const chatId = state.activeChat ? state.activeChat.id : '';

        if (!chatId || isChatPending(chatId)) {
            return;
        }

        const form = new FormData();
        form.append('action', 'regenerate_image');
        form.append('chat_id', chatId);
        form.append('message_id', message.id);

        startChatPending(chatId, 'image');

        try {
            const data = await request('api/generate.php', { method: 'POST', body: form });

            if (state.activeChat && state.activeChat.id === data.chat.id) {
                state.activeChat = data.chat;
                appendLocalMessages(data.chat.id);
                renderChat();
            }

            await loadChatSummaries();
            await loadGallery(0, false);
        } catch (exception) {
            if (exception.payload && exception.payload.chat) {
                if (state.activeChat && state.activeChat.id === exception.payload.chat.id) {
                    state.activeChat = exception.payload.chat;
                    appendLocalMessages(exception.payload.chat.id);
                    renderChat();
                }

                await loadChatSummaries();
            } else {
                appendClientError('Не удалось перегенерировать картинку.', exception, null, chatId, 'image');
            }
        } finally {
            finishChatPending(chatId);
        }
    }

    async function retryMessage(message) {
        const chatId = state.activeChat ? state.activeChat.id : '';

        if (!chatId || isChatPending(chatId)) {
            return;
        }

        const retryMode = message.mode === 'image' ? 'image' : 'chat';
        const form = new FormData();
        form.append('action', 'retry');
        form.append('chat_id', chatId);
        form.append('message_id', message.id);

        markMessageRetrying(message);

        startChatPending(chatId, retryMode);

        try {
            const data = await request('api/generate.php', { method: 'POST', body: form });

            if (state.activeChat && state.activeChat.id === data.chat.id) {
                state.activeChat = data.chat;
                appendLocalMessages(data.chat.id);
                renderChat();
            }

            await loadChatSummaries();
            if (retryMode === 'image') { await loadGallery(0, false); }
        } catch (exception) {
            if (exception.payload && exception.payload.chat) {
                if (state.activeChat && state.activeChat.id === exception.payload.chat.id) {
                    state.activeChat = exception.payload.chat;
                    appendLocalMessages(exception.payload.chat.id);
                    renderChat();
                }

                await loadChatSummaries();
                if (retryMode === 'image') { await loadGallery(0, false); }
            } else {
                appendClientError('Не удалось повторить запрос.', exception, null, chatId, retryMode);
            }
        } finally {
            finishChatPending(chatId);
        }
    }

    /* Оптимистично помечаем сообщение об ошибке как «в повторе», чтобы
       скрыть кнопку и показать состояние ожидания до ответа сервера. */
    function markMessageRetrying(message) {
        if (!state.activeChat || !Array.isArray(state.activeChat.messages)) {
            return;
        }

        const found = state.activeChat.messages.find(function (item) {
            return item && item.id === message.id && item.error;
        });

        if (found) {
            found.retrying = true;
            renderChat(false);
        }
    }

    function renderGallery() {
        const grid = $('[data-gallery]');
        grid.innerHTML = '';

        state.gallery.forEach(function (image, index) { grid.append(imageCard(image, false, null, false, state.gallery, index)); });
        renderGalleryMore();
    }

    function renderGalleryMore() {
        const holder = $('[data-gallery-more]');
        const button = $('[data-load-gallery-more]');

        if (!holder || !button) {
            return;
        }

        holder.hidden = !state.galleryPagination.hasMore && !state.galleryLoadingMore;
        button.disabled = state.galleryLoadingMore;
        button.textContent = state.galleryLoadingMore ? 'Загрузка...' : 'Загрузить ещё';

        if (state.galleryPagination.total > 0) {
            button.title = 'Показано ' + state.gallery.length + ' из ' + state.galleryPagination.total;
        } else {
            button.title = '';
        }
    }

    function imageCard(image, isLarge, chatId, showUsage, modalImages, modalIndex) {
        const modalImage = imageForModal(image, chatId);
        const modalContext = (Array.isArray(modalImages) && modalImages.length > 0 ? modalImages : [image]).map(function (item) {
            return imageForModal(item, chatId);
        });
        const contextIndex = modalIndex === undefined ? 0 : Math.min(modalContext.length - 1, Math.max(0, modalIndex));
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'image-card' + (isLarge ? ' image-card-large' : '');
        card.addEventListener('click', function () { openModal(modalImage, modalContext, contextIndex); });

        const img = document.createElement('img');
        img.alt = window.UsageFormatter.imageName(image);
        img.loading = 'lazy';
        if (isLarge) { img.addEventListener('load', scrollMessagesToBottom); }
        img.src = image.url;
        card.append(img);
        card.append(child('span', showUsage === false ? window.UsageFormatter.imageName(image) : window.UsageFormatter.imageLabel(image)));

        return card;
    }

    function scrollMessagesToBottom() {
        const messages = $('[data-messages]');
        [0, 50, 200, 600].forEach(function (delay) {
            setTimeout(function () { messages.scrollTop = messages.scrollHeight; }, delay);
        });
    }

    function renderRefs() {
        const tray = $('[data-refs-tray]');
        const input = $('[data-ref-input]');
        tray.innerHTML = '';

        Array.from(input.files || []).forEach(function (file, index) {
            const chip = child('button', file.name, 'ref-chip');
            chip.type = 'button';
            chip.title = 'Убрать референс';
            chip.addEventListener('click', function () {
                window.ReferenceDrop.removeFile(input, index, renderRefs);
            });
            tray.append(chip);
        });

        state.galleryRefs.forEach(function (path) {
            const chip = child('button', 'ref: ' + fileName(path), 'ref-chip');
            chip.type = 'button';
            chip.addEventListener('click', function () {
                state.galleryRefs = state.galleryRefs.filter(function (item) { return item !== path; });
                renderRefs();
            });
            tray.append(chip);
        });

        tray.hidden = tray.children.length === 0;
    }

    function handleRefsChange() {
        if (state.mode !== 'image') { setMode('image'); }
        renderRefs();
    }

    function rejectRefs(count) { setStatus('Пропущено файлов: ' + count); }

    function openModal(image, images, index) {
        const modal = $('[data-modal]');
        modal.hidden = false;

        const chatId = state.activeChat ? state.activeChat.id : '';
        const imageChatId = image && image.chatId ? image.chatId : chatId;

        /* Картинка из текущего чата — перелистываем по всем его картинкам
           (все сообщения и варианты). Картинка из галереи (другой чат) —
           перелистываем в рамках переданного списка. */
        if (imageChatId === chatId && chatId !== '') {
            const allImages = chatImagesForModal();

            if (allImages.length > 1) {
                state.modal.images = allImages;
                state.modal.index = findModalImageIndex(allImages, image);
                renderModalImage();
                return;
            }
        }

        state.modal.images = Array.isArray(images) && images.length > 0 ? images : [image];
        state.modal.index = index === undefined ? 0 : Math.min(state.modal.images.length - 1, Math.max(0, index));
        renderModalImage();
    }

    function findModalImageIndex(images, target) {
        const targetPath = target ? (target.path || target.url) : '';

        if (targetPath !== '') {
            const exact = images.findIndex(function (image) {
                return (image.path || image.url) === targetPath;
            });

            if (exact !== -1) {
                return exact;
            }
        }

        const targetUrl = target ? target.url : '';
        const byUrl = images.findIndex(function (image) {
            return image.url === targetUrl;
        });

        return byUrl === -1 ? 0 : byUrl;
    }

    function closeModal() {
        $('[data-modal]').hidden = true;
        const track = $('[data-modal-track]');

        if (track) {
            track.innerHTML = '';
            track.style.transform = '';
            track.classList.remove('is-dragging');
        }

        state.modal.images = [];
        state.modal.index = 0;
    }

    function stepModalImage(delta) {
        if (state.modal.images.length < 2) {
            return;
        }

        state.modal.index = Math.min(state.modal.images.length - 1, Math.max(0, state.modal.index + delta));
        renderModalImage();
    }

    function handleModalKeys(event) {
        const modal = $('[data-modal]');

        if (!modal || modal.hidden) {
            return;
        }

        /* Не перехватываем стрелки, пока пользователь печатает в поле ввода. */
        const tag = event.target && event.target.tagName ? event.target.tagName.toLowerCase() : '';
        const isEditable = tag === 'input' || tag === 'textarea' || tag === 'select' || event.target.isContentEditable;

        if (event.key === 'Escape') {
            event.preventDefault();
            closeModal();
            return;
        }

        if (isEditable) {
            return;
        }

        if (event.key === 'ArrowLeft') {
            event.preventDefault();
            stepModalImage(-1);
        } else if (event.key === 'ArrowRight') {
            event.preventDefault();
            stepModalImage(1);
        }
    }

    /* Свайп картинкой: живое перемещение за пальцем/мышью, при отпускании —
       перелистывание (если сдвиг больше порога) или плавный возврат. */
    function bindModalSwipe() {
        const wrap = document.querySelector('[data-modal-slider]');
        const modal = document.querySelector('[data-modal]');

        if (!wrap || !modal) {
            return;
        }

        const threshold = 60;
        let pointerId = null;
        let startX = 0;
        let startY = 0;
        let deltaX = 0;
        let dragging = false;
        let decided = false;

        wrap.addEventListener('pointerdown', function (event) {
            if (modal.hidden || state.modal.images.length < 2) {
                return;
            }

            /* Не начинаем свайп с кнопок навигации. */
            if (event.target.closest('.modal-nav')) {
                return;
            }

            pointerId = event.pointerId;
            startX = event.clientX;
            startY = event.clientY;
            deltaX = 0;
            dragging = false;
            decided = false;
            horizontal = false;
        });

        wrap.addEventListener('pointermove', function (event) {
            if (pointerId !== event.pointerId) {
                return;
            }

            const dx = event.clientX - startX;
            const dy = event.clientY - startY;

            /* Определяем направление жеста один раз — только если движение
               уже заметное. Преимущественно вертикальное → отдаём скролл. */
            if (!decided && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
                const horizontal = Math.abs(dx) > Math.abs(dy);
                decided = true;

                if (horizontal) {
                    dragging = true;
                    wrap.setPointerCapture(event.pointerId);
                    const track = $('[data-modal-track]');

                    if (track) { track.classList.add('is-dragging'); }
                } else {
                    pointerId = null;
                    return;
                }
            }

            if (!dragging) {
                return;
            }

            let dxAdjusted = dx;
            /* Сопротивление на краях списка: тянем за пределы —
               смещение затухает (резина). */
            const atStart = state.modal.index <= 0 && dx > 0;
            const atEnd = state.modal.index >= state.modal.images.length - 1 && dx < 0;

            if (atStart || atEnd) {
                dxAdjusted = dx * 0.35;
            }

            deltaX = dxAdjusted;

            /* Сдвиг track в пикселях (базовое положение + смещение драга). */
            applyModalTrackPosition(dxAdjusted);
        });

        function endSwipe(event) {
            if (pointerId !== event.pointerId) {
                return;
            }

            const wasDragging = dragging;
            const capturedDelta = deltaX;
            pointerId = null;
            dragging = false;
            decided = false;
            deltaX = 0;

            const track = $('[data-modal-track]');

            if (track) {
                track.classList.remove('is-dragging');
            }

            if (!wasDragging) {
                applyModalTrackPosition();
                return;
            }

            /* Порог перелистывания по реальному смещению (с учётом резины). */
            if (Math.abs(capturedDelta) > threshold) {
                stepModalImage(capturedDelta < 0 ? 1 : -1);
            } else {
                applyModalTrackPosition();
            }
        }

        wrap.addEventListener('pointerup', endSwipe);
        wrap.addEventListener('pointercancel', endSwipe);
    }

    function renderModalImage() {
        const image = state.modal.images[state.modal.index];
        const modal = $('[data-modal]');
        const chatButton = $('[data-open-chat]');
        const prevButton = $('[data-modal-prev]');
        const nextButton = $('[data-modal-next]');

        if (!image) {
            return;
        }

        modal.dataset.path = image.path || image.url;
        modal.dataset.url = image.url;
        modal.dataset.chatId = image.chatId || '';
        $('[data-modal-title]').textContent = window.UsageFormatter.imageName(image);
        $('[data-modal-meta]').textContent = modalMeta(image);
        $('[data-download]').href = image.url;
        $('[data-open-image]').href = image.url;
        chatButton.hidden = !image.chatId;
        chatButton.title = image.chatTitle ? 'Открыть: ' + image.chatTitle : 'Открыть чат';
        prevButton.hidden = state.modal.images.length < 2;
        nextButton.hidden = state.modal.images.length < 2;
        prevButton.disabled = state.modal.index <= 0;
        nextButton.disabled = state.modal.index >= state.modal.images.length - 1;

        renderModalTrack();
    }

    function renderModalTrack() {
        const track = $('[data-modal-track]');

        if (!track) {
            return;
        }

        track.classList.remove('is-dragging');
        track.style.transform = '';

        if (track.children.length !== state.modal.images.length) {
            track.innerHTML = '';
            state.modal.images.forEach(function (image) {
                const slide = document.createElement('div');
                slide.className = 'modal-slide';
                const img = document.createElement('img');
                img.alt = window.UsageFormatter.imageName(image);
                img.src = image.url;
                slide.append(img);
                track.append(slide);
            });
        }

        applyModalTrackPosition();
    }

    function applyModalTrackPosition(offsetPixels) {
        const track = $('[data-modal-track]');
        const wrap = document.querySelector('[data-modal-slider]');

        if (!track) {
            return;
        }

        const slideWidth = wrap ? wrap.getBoundingClientRect().width : track.getBoundingClientRect().width / Math.max(1, state.modal.images.length);
        const shift = -state.modal.index * slideWidth + (offsetPixels || 0);
        track.style.transform = 'translateX(' + shift + 'px)';
    }

    async function openModalChat() {
        const chatId = $('[data-modal]').dataset.chatId;
        if (!chatId) { return; }
        closeModal();
        await openChat(chatId);
    }

    async function copyModalLink() {
        const url = new URL($('[data-modal]').dataset.url, window.location.href).href;
        await navigator.clipboard.writeText(url);
        setStatus('Ссылка скопирована');
    }

    function modalMeta(image) {
        const parts = [
            (image.width || 0) + 'x' + (image.height || 0),
            bytes(image.bytes || 0),
        ];
        const generatedAt = window.UsageFormatter.imageDateTime(image);

        if (generatedAt !== '') {
            parts.push(generatedAt);
        }

        parts.push(window.UsageFormatter.full(image.usage));

        return parts.join(' · ');
    }

    function addModalReference() {
        const path = $('[data-modal]').dataset.path;

        if (path && state.galleryRefs.indexOf(path) === -1) {
            setMode('image');
            state.galleryRefs.push(path);
            renderRefs();
        }

        closeModal();
    }

    function imageForModal(image, chatId) {
        if (image.chatId || image.kind !== 'generated' || !chatId) { return image; }
        return Object.assign({}, image, { chatId: chatId, chatTitle: state.activeChat ? state.activeChat.title : '' });
    }

    /* Все картинки текущего чата для перелистывания в модалке:
       из всех сообщений и всех вариантов каждого image-сообщения. */
    function chatImagesForModal() {
        const result = [];

        if (!state.activeChat) {
            return result;
        }

        const chatId = state.activeChat.id;
        const messages = messagesWithPending(state.activeChat);

        messages.forEach(function (message) {
            if (message.role !== 'assistant' || message.mode !== 'image') {
                return;
            }

            const sources = [messageView(message)];
            imageVariants(message).forEach(function (variant) {
                if (variant && variant.id !== (sources[0].variantId || '') && Array.isArray(variant.images)) {
                    sources.push(variant);
                }
            });

            sources.forEach(function (source) {
                const images = Array.isArray(source.images) ? source.images : [];
                images.forEach(function (image) {
                    result.push(imageForModal(image, chatId));
                });
            });
        });

        return result;
    }

    async function request(url, options) {
        const init = options || {};
        init.credentials = 'same-origin';
        init.cache = 'no-store';
        init.headers = init.headers || {};

        if (init.method && init.method !== 'GET') {
            init.headers['X-CSRF-Token'] = boot.csrfToken;
        }

        let response;

        try {
            response = await fetch(url, init);
        } catch (exception) {
            const error = new Error('Сетевой запрос не выполнен: ' + exception.message);
            error.details = {
                type: exception.name || 'NetworkError',
                url: url,
            };
            throw error;
        }

        const text = await response.text();
        const payload = parseJson(text);

        if (!response.ok || payload.ok === false) {
            const error = new Error(payload.error || 'Request failed.');
            error.payload = payload;
            error.status = response.status;
            error.statusText = response.statusText;
            error.url = url;
            error.responseText = payload.error ? '' : text.slice(0, 1600);
            throw error;
        }

        return payload;
    }

    function parseJson(text) {
        if (!text) { return {}; }

        try {
            return JSON.parse(text);
        } catch (_exception) {
            return {};
        }
    }

    function startChatPending(chatId, mode, message) {
        state.pending[chatId] = { startedAt: Date.now(), mode: mode, message: message || null };
        startPendingTicker();
        renderSidebar();
        renderBusyState();

        if (state.activeChat && state.activeChat.id === chatId && message) {
            renderChat();
        }
    }

    function finishChatPending(chatId) {
        const pending = state.pending[chatId] || null;
        releasePendingMessageUrls(pending);
        delete state.pending[chatId];
        stopPendingTickerIfIdle();
        renderSidebar();
        renderBusyState();

        if (state.activeChat && state.activeChat.id === chatId) {
            renderChat(false);
        }
    }

    function releasePendingMessageUrls(pending) {
        const urls = pending && pending.message && Array.isArray(pending.message.objectUrls)
            ? pending.message.objectUrls
            : [];

        urls.forEach(function (url) {
            URL.revokeObjectURL(url);
        });
    }

    function startPendingTicker() {
        if (state.pendingTickId !== null) { return; }

        state.pendingTickId = setInterval(function () {
            renderBusyState();
            renderSidebarPendingTimes();
        }, 1000);
    }

    function stopPendingTickerIfIdle() {
        if (pendingCount() > 0 || state.pendingTickId === null) { return; }

        clearInterval(state.pendingTickId);
        state.pendingTickId = null;
    }

    function renderBusyState() {
        const send = $('[data-send]');
        const imageButton = $('[data-image-mode]');
        const pending = activePending();

        send.disabled = pending !== null;
        imageButton.disabled = pending !== null;

        if (pending !== null) {
            const label = busyLabel(pending.mode);
            const elapsed = formatDuration(Date.now() - pending.startedAt);
            send.textContent = label + ' ' + elapsed;
            setStatus(label + ' · ' + elapsed);
        } else {
            send.textContent = sendLabel();
            setStatus(pendingCount() > 0 ? 'Фоновых запросов: ' + pendingCount() : 'Готов');
        }

        $('[data-status]').classList.toggle('is-busy', pending !== null);
    }

    function renderSidebarPendingTimes() {
        document.querySelectorAll('[data-chat-pending-time]').forEach(function (node) {
            const item = node.closest('.chat-item');
            const pending = item ? state.pending[item.dataset.chatId] : null;

            if (pending) {
                node.textContent = sidebarPendingLabel(pending);
            }
        });
    }

    function setStatus(text) { $('[data-status]').textContent = text; }

    function isChatPending(chatId) { return Boolean(state.pending[chatId]); }

    function activePending() {
        if (!state.activeChat || !state.pending[state.activeChat.id]) {
            return null;
        }

        return state.pending[state.activeChat.id];
    }

    function pendingCount() { return Object.keys(state.pending).length; }

    function busyLabel(mode) { return mode === 'image' ? 'Генерация' : 'Ответ'; }

    function sidebarPendingLabel(pending) {
        return busyLabel(pending.mode) + ' · ' + formatDuration(Date.now() - pending.startedAt);
    }

    function formatDuration(milliseconds) {
        const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = String(totalSeconds % 60).padStart(2, '0');

        return minutes + ':' + seconds;
    }

    function appendClientError(title, exception, prompt, chatId, mode) {
        const now = new Date().toISOString();
        const message = exception && exception.message ? exception.message : title;
        const messageMode = mode || state.mode;
        const targetChatId = chatId || (state.activeChat ? state.activeChat.id : '');
        const messages = [];

        if (!targetChatId && !state.activeChat) {
            state.activeChat = {
                id: 'local_' + Date.now(),
                title: prompt || title,
                createdAt: now,
                updatedAt: now,
                messages: [],
                usage: null,
            };
        }

        if (prompt) {
            messages.push({
                id: tempId('msg'),
                role: 'user',
                content: prompt,
                createdAt: now,
                mode: messageMode,
            });
        }

        messages.push({
            id: tempId('err'),
            role: 'assistant',
            content: 'Ошибка: ' + message,
            createdAt: now,
            mode: messageMode,
            error: true,
            local: true,
            errorDetails: window.ChatErrors.detailsFromException(exception, title, messageMode),
        });

        if (targetChatId && (!state.activeChat || state.activeChat.id !== targetChatId)) {
            state.localMessages[targetChatId] = (state.localMessages[targetChatId] || []).concat(messages);
            renderSidebar();
        } else {
            state.activeChat.messages = state.activeChat.messages.concat(messages);
            renderChat();
        }

        setStatus(message);
    }

    async function renameActiveChat() {
        if (!state.activeChat) {
            return;
        }

        const existingInput = $('[data-chat-title-input]');

        if (existingInput) {
            existingInput.focus();
            existingInput.select();
            return;
        }

        const titleNode = $('[data-chat-title]');
        const button = $('[data-rename-chat]');
        const input = document.createElement('input');
        let closed = false;

        input.type = 'text';
        input.className = 'chat-title-input';
        input.value = state.activeChat.title || '';
        input.maxLength = 64;
        input.setAttribute('data-chat-title-input', '');
        input.setAttribute('aria-label', 'Название чата');
        titleNode.hidden = true;
        button.disabled = true;
        titleNode.after(input);
        input.focus();
        input.select();

        input.addEventListener('keydown', function (event) {
            if (event.key === 'Enter') {
                event.preventDefault();
                saveInlineChatTitle(input, titleNode, button, function () { closed = true; });
            }

            if (event.key === 'Escape') {
                event.preventDefault();
                closed = true;
                closeInlineChatTitle(input, titleNode, button);
            }
        });

        input.addEventListener('blur', function () {
            if (closed) {
                return;
            }

            saveInlineChatTitle(input, titleNode, button, function () { closed = true; });
        });
    }

    async function saveInlineChatTitle(input, titleNode, button, onClose) {
        if (input.dataset.saving === '1') {
            return;
        }

        input.dataset.saving = '1';
        const trimmed = input.value.trim();

        if (trimmed === '') {
            setStatus('Введите название чата.');
            input.dataset.saving = '0';
            input.focus();
            return;
        }

        if (!state.activeChat || trimmed === state.activeChat.title) {
            onClose();
            closeInlineChatTitle(input, titleNode, button);
            return;
        }

        const form = new FormData();
        form.append('action', 'rename');
        form.append('id', state.activeChat.id);
        form.append('title', trimmed);

        try {
            const data = await request('api/chats.php', { method: 'POST', body: form });
            state.activeChat = data.chat;
            appendLocalMessages(data.chat.id);
            await loadChatSummaries();
            setStatus('Название обновлено');
            onClose();
            closeInlineChatTitle(input, titleNode, button);
        } catch (exception) {
            input.dataset.saving = '0';
            input.focus();
            appendClientError('Не удалось переименовать чат.', exception);
        }
    }

    function closeInlineChatTitle(input, titleNode, button) {
        input.remove();
        titleNode.hidden = false;
        button.disabled = !state.activeChat;
        titleNode.textContent = state.activeChat ? state.activeChat.title : 'Новый чат';
    }

    function toggleImageMode() {
        setMode(state.mode === 'image' ? 'chat' : 'image');
    }

    function setMode(mode) {
        if (state.mode === mode) {
            renderMode();
            return;
        }

        state.mode = mode;

        if (mode === 'chat') { clearReferences(); }

        renderMode();
    }

    function renderMode() {
        const isImage = state.mode === 'image';
        const modeInput = $('[data-mode]');
        const imageControls = $('[data-image-controls]');
        const imageButton = $('[data-image-mode]');
        const prompt = $('[data-prompt]');
        const shell = $('[data-app-shell]');

        if (modeInput) { modeInput.value = state.mode; }
        if (imageControls) { imageControls.hidden = !isImage; }
        if (shell) { shell.classList.toggle('is-image-mode', isImage); }

        if (imageButton) {
            imageButton.classList.toggle('is-active', isImage);
            imageButton.setAttribute('aria-pressed', isImage ? 'true' : 'false');
        }

        if (prompt) {
            prompt.placeholder = isImage ? 'Опишите изображение...' : 'Напишите сообщение...';
        }

        renderBusyState();
    }

    function clearReferences() {
        const input = $('[data-ref-input]');

        if (input) { input.value = ''; }

        state.galleryRefs = [];
        renderRefs();
    }

    function sendLabel() { return state.mode === 'image' ? 'Сгенерировать' : 'Отправить'; }

    function normalizeGalleryPagination(pagination, offset, count) {
        const nextOffset = pagination && pagination.nextOffset !== null && pagination.nextOffset !== undefined
            ? positiveNumber(pagination.nextOffset, null)
            : null;

        return {
            offset: positiveNumber(pagination && pagination.offset, offset),
            limit: positiveNumber(pagination && pagination.limit, Number(boot.galleryPageSize) || 36),
            count: positiveNumber(pagination && pagination.count, count),
            total: positiveNumber(pagination && pagination.total, state.gallery.length),
            hasMore: Boolean(pagination && pagination.hasMore),
            nextOffset: nextOffset,
        };
    }

    function positiveNumber(value, fallback) {
        if (value === null || value === undefined || value === '') {
            return fallback;
        }

        const number = Number(value);

        return Number.isFinite(number) && number >= 0 ? number : fallback;
    }

    function child(tag, text, className) {
        const node = document.createElement(tag);
        node.textContent = text;

        if (className) {
            node.className = className;
        }

        return node;
    }

    function tempId(prefix) { return prefix + '_' + Date.now() + '_' + Math.random().toString(16).slice(2); }

    function roleName(role) { return role === 'user' ? 'Вы' : 'Ответ'; }

    function formatDate(value) {
        return value ? new Date(value).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }) : '';
    }

    function bytes(value) {
        if (value > 1048576) {
            return (value / 1048576).toFixed(1) + ' MB';
        }

        return Math.max(1, Math.round(value / 1024)) + ' KB';
    }

    function fileName(path) { return String(path).split('/').pop(); }

    function focusPrompt() {
        const prompt = $('[data-prompt]');

        if (prompt) {
            prompt.focus();
        }
    }

    function $(selector) { return document.querySelector(selector); }
}());
