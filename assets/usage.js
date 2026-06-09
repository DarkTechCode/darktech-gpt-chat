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
    return (image.file || "image") + " · " + short(image.usage);
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
    const value = Number((window.GPT_IMAGE_APP || {}).tokenMultiplier || 4);

    return Number.isFinite(value) && value > 0 ? value : 4;
  }

  window.UsageFormatter = { full: full, short: short, imageLabel: imageLabel };
})();
