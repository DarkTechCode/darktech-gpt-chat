(function () {
    const allowedTypes = ['image/png', 'image/jpeg', 'image/webp'];

    function bind(dropZone, input, onChange, onReject) {
        let dragDepth = 0;

        dropZone.addEventListener('dragenter', function (event) {
            if (!hasFiles(event)) { return; }
            event.preventDefault();
            dragDepth++;
            dropZone.classList.add('is-dragover');
        });

        dropZone.addEventListener('dragover', function (event) {
            if (!hasFiles(event)) { return; }
            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';
        });

        dropZone.addEventListener('dragleave', function (event) {
            if (!hasFiles(event)) { return; }
            dragDepth = Math.max(0, dragDepth - 1);
            if (dragDepth === 0) { dropZone.classList.remove('is-dragover'); }
        });

        dropZone.addEventListener('drop', function (event) {
            if (!hasFiles(event)) { return; }
            event.preventDefault();
            dragDepth = 0;
            dropZone.classList.remove('is-dragover');
            addFiles(input, Array.from(event.dataTransfer.files || []), onChange, onReject);
        });
    }

    function addFiles(input, files, onChange, onReject) {
        const accepted = files.filter(function (file) { return allowedTypes.indexOf(file.type) !== -1; });
        const rejected = files.length - accepted.length;

        if (accepted.length > 0) {
            setFiles(input, Array.from(input.files || []).concat(accepted));
            onChange();
        }

        if (rejected > 0 && onReject) { onReject(rejected); }
    }

    function removeFile(input, index, onChange) {
        const files = Array.from(input.files || []).filter(function (_file, fileIndex) {
            return fileIndex !== index;
        });
        setFiles(input, files);
        onChange();
    }

    function setFiles(input, files) {
        const transfer = new DataTransfer();
        files.forEach(function (file) { transfer.items.add(file); });
        input.files = transfer.files;
    }

    function hasFiles(event) {
        return Array.from(event.dataTransfer.types || []).indexOf('Files') !== -1;
    }

    window.ReferenceDrop = { bind: bind, removeFile: removeFile };
}());
