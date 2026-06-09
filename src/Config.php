<?php

declare(strict_types=1);

namespace GptImages;

use RuntimeException;

final class Config
{
    private $values;

    private function __construct(array $values)
    {
        $this->values = $values;
    }

    public static function load(string $path): self
    {
        if (!is_file($path)) {
            throw new RuntimeException('Config file was not found.');
        }

        $values = require $path;

        if (!is_array($values)) {
            throw new RuntimeException('Config file must return an array.');
        }

        return new self($values);
    }

    public function get(string $path, $default = null)
    {
        $value = $this->values;

        foreach (explode('.', $path) as $part) {
            if (!is_array($value) || !array_key_exists($part, $value)) {
                return $default;
            }

            $value = $value[$part];
        }

        return $value;
    }

    public function string(string $path, string $default = ''): string
    {
        $value = $this->get($path, $default);

        return is_string($value) ? $value : $default;
    }

    public function nullableString(string $path): ?string
    {
        $value = $this->get($path);

        return is_string($value) && $value !== '' ? $value : null;
    }

    public function integer(string $path, int $default = 0): int
    {
        $value = $this->get($path, $default);

        return is_numeric($value) ? (int) $value : $default;
    }

    public function floatValue(string $path, float $default = 0.0): float
    {
        $value = $this->get($path, $default);

        return is_numeric($value) ? (float) $value : $default;
    }

    public function arrayValue(string $path, array $default = []): array
    {
        $value = $this->get($path, $default);

        return is_array($value) ? $value : $default;
    }

    public function boolean(string $path, bool $default = false): bool
    {
        $value = $this->get($path, $default);

        return is_bool($value) ? $value : $default;
    }
}
