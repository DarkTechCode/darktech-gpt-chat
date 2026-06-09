(function () {
    const key = 'gpt-images.prompt-draft';
    let timerId = null;

    function bind(textarea) {
        if (!textarea) { return; }

        const saved = localStorage.getItem(key);

        if (saved !== null && textarea.value.trim() === '') {
            textarea.value = saved;
        }

        textarea.addEventListener('input', function () {
            clearTimeout(timerId);
            timerId = setTimeout(function () { save(textarea.value); }, 700);
        });
    }

    function clear() {
        clearTimeout(timerId);
        localStorage.removeItem(key);
    }

    function save(value) {
        if (value.trim() === '') {
            localStorage.removeItem(key);
            return;
        }

        localStorage.setItem(key, value);
    }

    window.PromptDraft = { bind: bind, clear: clear };
}());
