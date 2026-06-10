(function () {
    const keyPrefix = 'gpt-images.prompt-draft.';
    const emptyChatScope = 'new';
    let activeScope = emptyChatScope;
    let input = null;
    let timerId = null;

    function bind(textarea) {
        if (!textarea) { return; }

        input = textarea;
        load();

        textarea.addEventListener('input', function () {
            clearTimeout(timerId);
            timerId = setTimeout(function () { save(input.value); }, 700);
        });
    }

    function clear() {
        clearTimeout(timerId);
        localStorage.removeItem(currentKey());
    }

    function load() {
        if (!input) { return; }

        const saved = localStorage.getItem(currentKey());
        input.value = saved === null ? '' : saved;
    }

    function save(value) {
        if (value.trim() === '') {
            localStorage.removeItem(currentKey());
            return;
        }

        localStorage.setItem(currentKey(), value);
    }

    function saveCurrent() {
        clearTimeout(timerId);

        if (input) {
            save(input.value);
        }
    }

    function setChat(chatId) {
        const nextScope = scope(chatId);

        if (nextScope === activeScope) {
            return;
        }

        saveCurrent();
        activeScope = nextScope;
        load();
    }

    function scope(chatId) {
        if (chatId === null || chatId === undefined || String(chatId).trim() === '') {
            return emptyChatScope;
        }

        return encodeURIComponent(String(chatId));
    }

    function currentKey() {
        return keyPrefix + activeScope;
    }

    window.PromptDraft = { bind: bind, clear: clear, setChat: setChat };
}());
