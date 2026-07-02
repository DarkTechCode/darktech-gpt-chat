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
        $('[data-copy-link]').addEventListener('click', copyModalLink);
        $('[data-open-chat]').addEventListener('click', openModalChat);
        $('[data-modal-reference]').addEventListener('click', addModalReference);
        renderMode();
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
            focusPrompt();
        }
    }

    async function openChat(chatId) {
        const data = await request('api/chats.php?id=' + encodeURIComponent(chatId));
        state.activeChat = data.chat;
        appendLocalMessages(chatId);
        renderSidebar();
        renderChat();
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

    function renderSidebar() {
        const list = $('[data-chat-list]');
        list.innerHTML = '';
        $('[data-global-usage]').textContent = 'все чаты: ' + window.UsageFormatter.short(state.usage);

        state.chats.forEach(function (chat) {
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
            const article = document.createElement('article');
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
            if (canRegenerateImage(message)) { article.append(imageVariantControls(message)); }

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

        state.imageIndexes[imageIndexKey(message)] = Math.min(images.length - 1, Math.max(0, index));
        renderChat(false);
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
            controls.append(variantButton('‹', 'Предыдущая картинка', function () {
                setActiveImageIndex(message, imageIndex - 1);
            }, imageIndex <= 0));
            controls.append(child('span', 'Картинка ' + (imageIndex + 1) + ' / ' + images.length, 'image-variant-count'));
            controls.append(variantButton('›', 'Следующая картинка', function () {
                setActiveImageIndex(message, imageIndex + 1);
            }, imageIndex >= images.length - 1));
        }

        if (variants.length > 1) {
            controls.append(variantButton('‹', 'Предыдущий вариант', function () {
                activateImageVariant(message, activeIndex - 1).catch(function (exception) {
                    appendClientError('Не удалось переключить вариант.', exception);
                });
            }, pending || activeIndex <= 0));
            controls.append(child('span', 'Вариант ' + (activeIndex + 1) + ' / ' + variants.length, 'image-variant-count'));
            controls.append(variantButton('›', 'Следующий вариант', function () {
                activateImageVariant(message, activeIndex + 1).catch(function (exception) {
                    appendClientError('Не удалось переключить вариант.', exception);
                });
            }, pending || activeIndex >= variants.length - 1));
        }

        controls.append(variantButton('↻', 'Перегенерировать', function () {
            regenerateImage(message);
        }, pending));

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

    async function activateImageVariant(message, index) {
        if (!state.activeChat) {
            return;
        }

        const variants = imageVariants(message);
        const variant = variants[index];

        if (!variant || !variant.id) {
            return;
        }

        const form = new FormData();
        form.append('action', 'activate_variant');
        form.append('id', state.activeChat.id);
        form.append('message_id', message.id);
        form.append('variant_id', variant.id);

        const data = await request('api/chats.php', { method: 'POST', body: form });

        if (state.activeChat && state.activeChat.id === data.chat.id) {
            state.activeChat = data.chat;
            appendLocalMessages(data.chat.id);
            renderChat(false);
        }

        await loadChatSummaries();
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
        state.modal.images = Array.isArray(images) && images.length > 0 ? images : [image];
        state.modal.index = index === undefined ? 0 : Math.min(state.modal.images.length - 1, Math.max(0, index));
        renderModalImage();
    }

    function closeModal() {
        $('[data-modal]').hidden = true;
        $('[data-modal-image]').src = '';
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
        $('[data-modal-image]').src = image.url;
        $('[data-download]').href = image.url;
        $('[data-open-image]').href = image.url;
        chatButton.hidden = !image.chatId;
        chatButton.title = image.chatTitle ? 'Открыть: ' + image.chatTitle : 'Открыть чат';
        prevButton.hidden = state.modal.images.length < 2;
        nextButton.hidden = state.modal.images.length < 2;
        prevButton.disabled = state.modal.index <= 0;
        nextButton.disabled = state.modal.index >= state.modal.images.length - 1;
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
