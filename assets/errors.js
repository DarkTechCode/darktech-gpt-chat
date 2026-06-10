(function () {
    function detailsFromException(exception, title, mode) {
        const payload = exception && exception.payload ? exception.payload : {};
        const payloadDetails = payload.errorDetails || {};
        const details = Object.assign({}, payloadDetails);

        details.message = details.message || (exception && exception.message ? exception.message : title);
        details.type = details.type || (exception && exception.name ? exception.name : 'Error');
        details.mode = details.mode || mode;
        details.occurredAt = details.occurredAt || new Date().toISOString();

        if (exception && exception.status) { details.status = exception.status + ' ' + (exception.statusText || ''); }
        if (exception && exception.url) { details.url = exception.url; }
        if (exception && exception.responseText) { details.responseText = exception.responseText; }
        if (exception && exception.details) { details.extra = exception.details; }

        return details;
    }

    function panel(details) {
        const node = document.createElement('details');
        node.className = 'error-details';
        node.open = true;
        node.append(child('summary', 'Детали ошибки'));

        const rows = document.createElement('div');
        rows.className = 'error-detail-rows';
        appendDetailRow(rows, 'Сообщение', details.message);
        appendDetailRow(rows, 'Тип', details.type);
        appendDetailRow(rows, 'Режим', modeLabel(details.mode));
        appendDetailRow(rows, 'Время', formatDate(details.occurredAt));
        appendDetailRow(rows, 'HTTP', details.status);
        appendDetailRow(rows, 'URL', details.url);
        appendDetailRow(rows, 'Файл', details.file && details.line ? details.file + ':' + details.line : details.file);
        node.append(rows);

        if (details.responseText) {
            node.append(errorPre('Ответ сервера', details.responseText));
        }

        if (details.trace && details.trace.length) {
            node.append(errorPre('Трассировка', details.trace.join('\n')));
        }

        if (details.extra) {
            node.append(errorPre('Дополнительно', JSON.stringify(details.extra, null, 2)));
        }

        return node;
    }

    function appendDetailRow(container, label, value) {
        if (value === undefined || value === null || value === '') { return; }

        const row = document.createElement('div');
        row.className = 'error-detail-row';
        row.append(child('span', label));
        row.append(child('code', String(value)));
        container.append(row);
    }

    function errorPre(title, text) {
        const block = document.createElement('div');
        block.className = 'error-pre';
        block.append(child('strong', title));
        block.append(child('pre', String(text)));

        return block;
    }

    function child(tag, text) {
        const node = document.createElement(tag);
        node.textContent = text;

        return node;
    }

    function formatDate(value) {
        return value ? new Date(value).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }) : '';
    }

    function modeLabel(mode) { return mode === 'image' ? 'Картинки' : 'Чат'; }

    window.ChatErrors = {
        detailsFromException: detailsFromException,
        panel: panel,
    };
}());
