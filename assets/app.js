(function () {
    const boot = window.GPT_CHAT_APP || {};
    const state = { chats: [], activeChat: null, gallery: [], galleryRefs: [], usage: null, mode: 'chat', busy: false };

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
        $('[data-logout]').addEventListener('click', logout);
        $('[data-composer]').addEventListener('submit', generate);
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
        const data = await request('api/chats.php');
        state.chats = data.chats || [];
        state.usage = data.usage || null;
        renderSidebar();

        const activeId = preferredId || (state.activeChat && state.activeChat.id) || (state.chats[0] && state.chats[0].id);

        if (activeId) {
            await openChat(activeId);
        } else {
            state.activeChat = null;
            renderChat();
        }
    }

    async function openChat(chatId) {
        const data = await request('api/chats.php?id=' + encodeURIComponent(chatId));
        state.activeChat = data.chat;
        renderSidebar();
        renderChat();
    }

    async function createChat() {
        try {
            setMode('chat');
            const form = new FormData();
            form.append('title', 'Новый чат');
            const data = await request('api/chats.php', { method: 'POST', body: form });
            state.activeChat = data.chat;
            await loadChats(data.chat.id);
        } catch (exception) {
            appendClientError('Не удалось создать чат.', exception);
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
        let finalStatus = 'Готов';

        if (!prompt) { return; }

        form.set('mode', state.mode);

        if (state.activeChat) { form.append('chat_id', state.activeChat.id); }

        if (state.mode === 'image') {
            state.galleryRefs.forEach(function (path) { form.append('gallery_refs[]', path); });
        }

        setBusy(true);
        startGenerationTimer();

        try {
            const data = await request('api/generate.php', { method: 'POST', body: form });
            finalStatus = 'Готов · ' + formatTimer(stopGenerationTimer());
            state.activeChat = data.chat;
            composer.reset();
            window.PromptDraft.clear();
            state.galleryRefs = [];
            renderRefs();
            renderMode();
            renderChat();
            await loadChats(data.chat.id);
            if (state.mode === 'image') { await loadGallery(); }
        } catch (exception) {
            finalStatus = exception.message + ' · ' + formatTimer(stopGenerationTimer());

            if (exception.payload && exception.payload.chat) {
                state.activeChat = exception.payload.chat;
                renderChat();
            } else {
                appendClientError('Не удалось получить ответ.', exception, prompt);
            }
        } finally {
            setBusy(false);
            setStatus(finalStatus);
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
            item.className = 'chat-item' + (state.activeChat && state.activeChat.id === chat.id ? ' is-active' : '');
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

    function startGenerationTimer() {
        const busyLabel = state.mode === 'image' ? 'Генерация' : 'Ответ';

        if (!window.GenerationTimer) {
            setStatus(busyLabel);
            return;
        }

        window.GenerationTimer.start(function (label) {
            setStatus(busyLabel + ' · ' + label);
            $('[data-send]').textContent = busyLabel + ' ' + label;
        });
    }

    function stopGenerationTimer() { return window.GenerationTimer ? window.GenerationTimer.stop() : 0; }

    function formatTimer(milliseconds) { return window.GenerationTimer ? window.GenerationTimer.format(milliseconds) : '0:00'; }

    function setBusy(isBusy) {
        const send = $('[data-send]');
        state.busy = isBusy;
        send.disabled = isBusy;
        $('[data-image-mode]').disabled = isBusy;

        if (!isBusy) { send.textContent = sendLabel(); }

        $('[data-status]').classList.toggle('is-busy', isBusy);
    }

    function setStatus(text) { $('[data-status]').textContent = text; }

    function appendClientError(title, exception, prompt) {
        const now = new Date().toISOString();
        const message = exception && exception.message ? exception.message : title;

        if (!state.activeChat) {
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
            state.activeChat.messages.push({
                id: tempId('msg'),
                role: 'user',
                content: prompt,
                createdAt: now,
                mode: state.mode,
            });
        }

        state.activeChat.messages.push({
            id: tempId('err'),
            role: 'assistant',
            content: 'Ошибка: ' + message,
            createdAt: now,
            mode: state.mode,
            error: true,
            errorDetails: window.ChatErrors.detailsFromException(exception, title, state.mode),
        });

        renderChat();
        setStatus(message);
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

        if (!state.busy) { $('[data-send]').textContent = sendLabel(); }
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
