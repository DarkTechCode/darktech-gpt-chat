(function () {
  const tokenMultiplier = multiplier();

  function full(usage) {
    if (!hasUsage(usage)) {
      return "токены: нет данных";
    }

    const parts = ["токены: " + number(adjust(usage.totalTokens))];

    if (usage.inputTokens) {
      parts.push("вход " + number(adjust(usage.inputTokens)));
    }

    if (usage.outputTokens) {
      parts.push("выход " + number(adjust(usage.outputTokens)));
    }

    return parts.join(" · ");
  }

  function short(usage) {
    return hasUsage(usage)
      ? number(adjust(usage.totalTokens)) + " ток."
      : "токены: нет данных";
  }

  function imageLabel(image) {
    return imageName(image) + " · " + short(image.usage);
  }

  function imageName(image) {
    const timestamp = fileTimestamp(image);

    if (timestamp) {
      return timestamp.prefix + " " + timestamp.day + "." + timestamp.month + " " + timestamp.time;
    }

    return image.originalName || image.file || "image";
  }

  function imageDateTime(image) {
    const timestamp = fileTimestamp(image);

    if (timestamp) {
      return timestamp.day + "." + timestamp.month + "." + timestamp.year + " " + timestamp.time;
    }

    if (image.modifiedAt) {
      return dateTimeFromUnix(image.modifiedAt);
    }

    return "";
  }

  function fileTimestamp(image) {
    const file = String((image && image.file) || "");
    const match = file.match(/^([a-z]+)-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-/i);

    if (!match) {
      return null;
    }

    return {
      prefix: match[1].toLowerCase(),
      year: match[2],
      month: match[3],
      day: match[4],
      time: match[5] + ":" + match[6] + ":" + match[7],
    };
  }

  function dateTimeFromUnix(value) {
    const date = new Date(Number(value) * 1000);

    if (Number.isNaN(date.getTime())) {
      return "";
    }

    return [
      String(date.getDate()).padStart(2, "0"),
      String(date.getMonth() + 1).padStart(2, "0"),
      date.getFullYear(),
    ].join(".") + " " + [
      String(date.getHours()).padStart(2, "0"),
      String(date.getMinutes()).padStart(2, "0"),
      String(date.getSeconds()).padStart(2, "0"),
    ].join(":");
  }

  function hasUsage(usage) {
    return Boolean(usage && usage.hasUsage !== false && usage.totalTokens);
  }

  function number(value) {
    return Number(value || 0).toLocaleString("ru-RU");
  }

  function adjust(value) {
    return Number(value || 0) * tokenMultiplier;
  }

  function multiplier() {
    const value = Number((window.GPT_CHAT_APP || {}).tokenMultiplier || 4);

    return Number.isFinite(value) && value > 0 ? value : 4;
  }

  window.UsageFormatter = {
    full: full,
    short: short,
    imageLabel: imageLabel,
    imageName: imageName,
    imageDateTime: imageDateTime,
  };
})();
