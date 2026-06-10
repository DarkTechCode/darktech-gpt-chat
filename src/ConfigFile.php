<?php

declare(strict_types=1);

namespace GptImages;

use RuntimeException;

final class ConfigFile
{
    private $path;

    public function __construct(string $path)
    {
        $this->path = $path;
    }

    public function publicSettings(): array
    {
        $values = $this->read();

        return [
            'api' => [
                'baseUrl' => $this->string($values, 'api.base_url'),
                'tokenConfigured' => $this->string($values, 'api.token') !== ''
                    && $this->string($values, 'api.token') !== 'sk-...',
                'model' => $this->string($values, 'api.model'),
                'timeoutSeconds' => $this->integer($values, 'api.timeout_seconds'),
            ],
            'usage' => [
                'tokenMultiplier' => $this->float($values, 'usage.token_multiplier'),
            ],
            'auth' => [
                'passwordEnabled' => $this->passwordEnabled($values),
            ],
            'prompts' => [
                'chat' => $this->string($values, 'prompts.chat'),
                'image' => $this->string($values, 'prompts.image'),
            ],
        ];
    }

    public function update(array $input): array
    {
        $values = $this->read();
        $values['api']['base_url'] = $this->requiredString($input, 'api.baseUrl', 'API URL');
        $token = $this->optionalString($input, 'api.token');

        if ($token !== null && $token !== '') {
            $values['api']['token'] = $token;
        }
        $values['api']['model'] = $this->requiredString($input, 'api.model', 'Модель');
        $values['api']['timeout_seconds'] = $this->positiveInteger($input, 'api.timeoutSeconds', 'Таймаут');
        $values['usage']['token_multiplier'] = $this->positiveFloat($input, 'usage.tokenMultiplier', 'Коэффициент токенов');
        $values['prompts']['chat'] = $this->requiredString($input, 'prompts.chat', 'Промпт обычного чата');
        $values['prompts']['image'] = $this->requiredString($input, 'prompts.image', 'Промпт картинок');

        $password = $this->optionalString($input, 'auth.password');

        if ($password !== null) {
            $values['auth']['password'] = $password;
            $values['auth']['password_hash'] = null;
        }

        $this->write($values);

        return $this->publicSettings();
    }

    private function read(): array
    {
        if (!is_file($this->path)) {
            throw new RuntimeException('Config file was not found.');
        }

        $values = require $this->path;

        if (!is_array($values)) {
            throw new RuntimeException('Config file must return an array.');
        }

        return $values;
    }

    private function write(array $values): void
    {
        $contents = "<?php\n\n" .
            "declare(strict_types=1);\n\n" .
            "return " . $this->exportValue($values, 0) . ";\n";

        if (file_put_contents($this->path, $contents, LOCK_EX) === false) {
            throw new RuntimeException('Unable to write config.php.');
        }
    }

    private function passwordEnabled(array $values): bool
    {
        return $this->string($values, 'auth.password') !== ''
            || $this->string($values, 'auth.password_hash') !== '';
    }

    private function requiredString(array $input, string $path, string $label): string
    {
        $value = $this->optionalString($input, $path);

        if ($value === null || $value === '') {
            throw new RuntimeException($label . ': заполните поле.');
        }

        return $value;
    }

    private function optionalString(array $input, string $path): ?string
    {
        $value = $this->value($input, $path);

        if ($value === null) {
            return null;
        }

        return trim((string) $value);
    }

    private function positiveInteger(array $input, string $path, string $label): int
    {
        $value = $this->value($input, $path);

        if (!is_numeric($value) || (int) $value <= 0) {
            throw new RuntimeException($label . ': укажите положительное число.');
        }

        return (int) $value;
    }

    private function positiveFloat(array $input, string $path, string $label): float
    {
        $value = $this->value($input, $path);

        if (!is_numeric($value) || (float) $value <= 0.0) {
            throw new RuntimeException($label . ': укажите положительное число.');
        }

        return (float) $value;
    }

    private function string(array $source, string $path): string
    {
        $value = $this->value($source, $path);

        return is_string($value) ? $value : '';
    }

    private function integer(array $source, string $path): int
    {
        $value = $this->value($source, $path);

        return is_numeric($value) ? (int) $value : 0;
    }

    private function float(array $source, string $path): float
    {
        $value = $this->value($source, $path);

        return is_numeric($value) ? (float) $value : 0.0;
    }

    private function value(array $source, string $path)
    {
        $value = $source;

        foreach (explode('.', $path) as $part) {
            if (!is_array($value) || !array_key_exists($part, $value)) {
                return null;
            }

            $value = $value[$part];
        }

        return $value;
    }

    private function exportValue($value, int $level): string
    {
        if (is_array($value)) {
            return $this->exportArray($value, $level);
        }

        if (is_string($value)) {
            return $this->exportString($value);
        }

        if ($value === null) {
            return 'null';
        }

        if (is_bool($value)) {
            return $value ? 'true' : 'false';
        }

        if (is_float($value) || is_int($value)) {
            return (string) $value;
        }

        return var_export($value, true);
    }

    private function exportArray(array $value, int $level): string
    {
        if (count($value) === 0) {
            return '[]';
        }

        $indent = str_repeat('    ', $level);
        $childIndent = str_repeat('    ', $level + 1);
        $lines = ['['];

        foreach ($value as $key => $item) {
            $lines[] = $childIndent
                . var_export($key, true)
                . ' => '
                . $this->exportValue($item, $level + 1)
                . ',';
        }

        $lines[] = $indent . ']';

        return implode("\n", $lines);
    }

    private function exportString(string $value): string
    {
        $relativePath = $this->relativeConfigPath($value);

        if ($relativePath !== null) {
            return "__DIR__ . '" . $this->escapeString('/' . $relativePath) . "'";
        }

        return "'" . $this->escapeString($value) . "'";
    }

    private function relativeConfigPath(string $value): ?string
    {
        if ($value === '') {
            return null;
        }

        $directory = realpath(dirname($this->path));

        if ($directory === false) {
            return null;
        }

        $normalizedDirectory = str_replace('\\', '/', $directory);
        $normalizedValue = str_replace('\\', '/', $value);
        $prefix = rtrim($normalizedDirectory, '/') . '/';

        if (stripos($normalizedValue, $prefix) !== 0) {
            return null;
        }

        return substr($normalizedValue, strlen($prefix));
    }

    private function escapeString(string $value): string
    {
        return str_replace(['\\', "'"], ['\\\\', "\\'"], $value);
    }
}
