(function () {
    let startedAt = 0;
    let timerId = null;

    window.GenerationTimer = {
        start: function (onTick) {
            startedAt = Date.now();
            clearInterval(timerId);
            onTick(this.format(0));
            timerId = setInterval(function () {
                onTick(window.GenerationTimer.format(Date.now() - startedAt));
            }, 1000);

            return startedAt;
        },
        stop: function () {
            const elapsed = startedAt > 0 ? Date.now() - startedAt : 0;
            clearInterval(timerId);
            timerId = null;
            startedAt = 0;

            return elapsed;
        },
        format: function (milliseconds) {
            const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
            const minutes = Math.floor(totalSeconds / 60);
            const seconds = String(totalSeconds % 60).padStart(2, '0');

            return minutes + ':' + seconds;
        },
    };
}());
