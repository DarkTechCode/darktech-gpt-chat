(function () {
    const boot = window.GPT_CHAT_APP || {};
    const state = {
        chats: [],
        activeChat: null,
        gallery: [],
        galleryRefs: [],
        usage: null,
        mode: 'chat',
        pending: {},
        pendingTickId: null,
        localMessages: {},
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
        $('[data-new-chat]').addEventListener('click', createChat);
        if ($('[data-logout]')) { $('[data-logout]').addEventListener('click', logout); }
        $('[data-composer]').addEventListener('submit', generate);
        $('[data-rename-chat]').addEventListener('click', renameActiveChat);
        $('[data-image-mode]').addEventListener('click', toggleImageMode);
        window.PromptDraft.bind($('[data-prompt]'));
        $('[data-attach]').addEventListener('click', function () { setMode('image'); $('[data-ref-input]').click(); });
        $('[data-ref-input]').addEventListener('change', handleRefsChange);
        window.ReferenceDrop.bind($('[data-composer]'), $('[data-ref-input]'), handleRefsChange, rejectRefs);
        $('[data-refresh-gallery]').addEventListener('click', refreshGallery);
        document.querySelectorAll('[data-close-modal]').forEach(function (node) {
            node.addEventListener('click', closeModal);
        });
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

        form.set('mode', requestMode);
        form.append('chat_id', requestChat.id);

        if (requestMode === 'image') {
            requestRefs.forEach(function (path) { form.append('gallery_refs[]', path); });
        }

        startChatPending(requestChat.id, requestMode);
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
            if (requestMode === 'image') { await loadGallery(); }
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

    async function loadGallery() { const data = await request('api/gallery.php'); state.gallery = data.images || []; renderGallery(); }

    async function refreshGallery() {
        try {
            await loadGallery();
        } catch (exception) {
            appendClientError('Не удалось загрузить галерею.', exception);
        }
    }

    function renderSidebar() {
        const list = $('[data-chat-list]');
        list.innerHTML = '';
        $('[data-global-usage]').textContent = 'все чаты: ' + window.UsageFormatter.short(state.usage);

        state.chats.forEach(function (chat) {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'chat-item'
                + (state.activeChat && state.activeChat.id === chat.id ? ' is-active' : '')
                + (isChatPending(chat.id) ? ' is-pending' : '');
            item.addEventListener('click', function () {
                openChat(chat.id).catch(function (exception) {
                    appendClientError('Не удалось открыть чат.', exception);
                });
            });
            item.append(child('strong', chat.title));
            item.append(child('span', chat.preview || ''));
            item.append(child('span', window.UsageFormatter.short(chat.usage), 'chat-usage'));
            list.append(item);
        });
    }

    function renderChat() {
        const title = $('[data-chat-title]');
        const messages = $('[data-messages]');
        messages.innerHTML = '';
        title.textContent = state.activeChat ? state.activeChat.title : 'Новый чат';
        $('[data-chat-usage]').textContent = state.activeChat ? window.UsageFormatter.full(state.activeChat.usage) : 'токены: нет данных';
        $('[data-rename-chat]').disabled = !state.activeChat;
        renderBusyState();

        if (!state.activeChat || !state.activeChat.messages.length) {
            messages.append(child('div', 'Новый чат', 'empty-state'));
            return;
        }

        state.activeChat.messages.forEach(function (message) {
            const article = document.createElement('article');
            article.className = 'message ' + message.role + (message.error ? ' is-error' : '');
            article.append(child('div', roleName(message.role) + ' · ' + formatDate(message.createdAt), 'message-head'));
            article.append(child('div', message.content || '', 'bubble'));
            if (message.errorDetails) { article.append(window.ChatErrors.panel(message.errorDetails)); }

            if (message.images && message.images.length) { article.append(imageStrip(message.images, message.role, state.activeChat.id)); }

            messages.append(article);
        });

        scrollMessagesToBottom();
    }

    function imageStrip(images, role, chatId) {
        const strip = document.createElement('div');
        strip.className = 'image-strip';

        if (role === 'assistant') { strip.classList.add('image-strip-large'); }

        images.forEach(function (image) {
            strip.append(imageCard(image, role === 'assistant' && image.kind === 'generated', chatId));
        });
        return strip;
    }

    function renderGallery() {
        const grid = $('[data-gallery]');
        grid.innerHTML = '';

        state.gallery.forEach(function (image) { grid.append(imageCard(image, false, null)); });
    }

    function imageCard(image, isLarge, chatId) {
        const modalImage = imageForModal(image, chatId);
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'image-card' + (isLarge ? ' image-card-large' : '');
        card.addEventListener('click', function () { openModal(modalImage); });

        const img = document.createElement('img');
        img.alt = image.file || '';
        img.loading = 'lazy';
        if (isLarge) { img.addEventListener('load', scrollMessagesToBottom); }
        img.src = image.url;
        card.append(img);
        card.append(child('span', window.UsageFormatter.imageLabel(image)));

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

    function openModal(image) {
        const modal = $('[data-modal]');
        const chatButton = $('[data-open-chat]');
        modal.hidden = false;
        modal.dataset.path = image.path || image.url;
        modal.dataset.url = image.url;
        modal.dataset.chatId = image.chatId || '';
        $('[data-modal-title]').textContent = image.file || 'image';
        $('[data-modal-meta]').textContent = (image.width || 0) + 'x' + (image.height || 0) + ' · ' + bytes(image.bytes || 0) + ' · ' + window.UsageFormatter.full(image.usage);
        $('[data-modal-image]').src = image.url;
        $('[data-download]').href = image.url;
        $('[data-open-image]').href = image.url;
        chatButton.hidden = !image.chatId;
        chatButton.title = image.chatTitle ? 'Открыть: ' + image.chatTitle : 'Открыть чат';
    }

    function closeModal() { $('[data-modal]').hidden = true; $('[data-modal-image]').src = ''; }

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

    function startChatPending(chatId, mode) {
        state.pending[chatId] = { startedAt: Date.now(), mode: mode };
        startPendingTicker();
        renderSidebar();
        renderBusyState();
    }

    function finishChatPending(chatId) {
        delete state.pending[chatId];
        stopPendingTickerIfIdle();
        renderSidebar();
        renderBusyState();
    }

    function startPendingTicker() {
        if (state.pendingTickId !== null) { return; }

        state.pendingTickId = setInterval(renderBusyState, 1000);
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

    function $(selector) { return document.querySelector(selector); }
}());
