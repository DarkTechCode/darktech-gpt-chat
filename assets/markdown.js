(function () {
    const aliases = {
        console: 'bash',
        htm: 'markup',
        html: 'markup',
        js: 'javascript',
        md: 'markdown',
        plaintext: 'text',
        shell: 'bash',
        sh: 'bash',
        txt: 'text',
        xml: 'markup',
    };

    const renderer = window.marked && window.marked.Renderer ? new window.marked.Renderer() : null;

    if (renderer) {
        renderer.code = function (code, language, escaped) {
            const normalizedLanguage = normalizeLanguage(language);
            const body = escaped ? String(code) : escapeHtml(String(code));

            return '<pre class="line-numbers language-' + normalizedLanguage + '"><code class="language-'
                + normalizedLanguage + '">' + body.replace(/\n$/, '') + '</code></pre>\n';
        };
    }

    window.ChatMarkdown = {
        render: render,
    };

    function render(node, text) {
        const content = String(text || '');

        node.classList.add('message-markdown');

        if (!renderer || !window.marked || !window.DOMPurify) {
            node.textContent = content;
            return;
        }

        node.innerHTML = window.DOMPurify.sanitize(window.marked.parse(content, {
            breaks: true,
            gfm: true,
            renderer: renderer,
        }), {
            ADD_ATTR: ['class', 'rel', 'target'],
            FORBID_TAGS: ['style'],
        });

        prepareLinks(node);
        prepareCodeBlocks(node);

        if (window.Prism) {
            window.Prism.highlightAllUnder(node);
        }
    }

    function prepareLinks(root) {
        root.querySelectorAll('a[href]').forEach(function (link) {
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
        });
    }

    function prepareCodeBlocks(root) {
        root.querySelectorAll('pre > code').forEach(function (code) {
            const pre = code.parentElement;
            const language = normalizeLanguage(languageFrom(code) || languageFrom(pre));

            pre.classList.add('line-numbers', 'language-' + language);
            code.classList.add('language-' + language);
        });
    }

    function languageFrom(node) {
        const match = String(node.className || '').match(/\blanguage-([a-z0-9_+#.-]+)/i);

        return match ? match[1] : '';
    }

    function normalizeLanguage(language) {
        const name = String(language || 'text')
            .trim()
            .split(/\s+/)[0]
            .toLowerCase()
            .replace(/[^a-z0-9_+#.-]/g, '');

        return aliases[name] || name || 'text';
    }

    function escapeHtml(value) {
        return value
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
}());
