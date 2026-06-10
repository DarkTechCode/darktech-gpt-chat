<?php

declare(strict_types=1);

namespace GptImages;

final class Auth
{
    private $config;

    public function __construct(Config $config)
    {
        $this->config = $config;
    }

    public function start(): void
    {
        if (session_status() === PHP_SESSION_ACTIVE) {
            return;
        }

        $name = $this->config->string('auth.session_name', 'gpt_chat_session');

        if ($name !== '') {
            session_name($name);
        }

        session_start();
    }

    public function isAuthenticated(): bool
    {
        if (!$this->isEnabled()) {
            return true;
        }

        return isset($_SESSION['authenticated']) && $_SESSION['authenticated'] === true;
    }

    public function login(string $password): bool
    {
        if (!$this->isEnabled()) {
            $_SESSION['csrf_token'] = bin2hex(random_bytes(32));

            return true;
        }

        if (!$this->passwordMatches($password)) {
            return false;
        }

        session_regenerate_id(true);
        $_SESSION['authenticated'] = true;
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));

        return true;
    }

    public function logout(): void
    {
        $_SESSION = [];

        if (session_status() === PHP_SESSION_ACTIVE) {
            session_destroy();
        }
    }

    public function requireAuth(): void
    {
        if (!$this->isAuthenticated()) {
            JsonResponse::send(['ok' => false, 'error' => 'Authentication required.'], 401);
        }
    }

    public function csrfToken(): string
    {
        if (empty($_SESSION['csrf_token'])) {
            $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
        }

        return (string) $_SESSION['csrf_token'];
    }

    public function verifyCsrf(): void
    {
        $sent = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? ($_POST['csrf_token'] ?? '');

        if (!is_string($sent) || !hash_equals($this->csrfToken(), $sent)) {
            JsonResponse::send(['ok' => false, 'error' => 'Invalid CSRF token.'], 419);
        }
    }

    private function passwordMatches(string $password): bool
    {
        $hash = $this->config->nullableString('auth.password_hash');

        if ($hash !== null) {
            return password_verify($password, $hash);
        }

        $plain = $this->config->string('auth.password', '');

        return $plain !== '' && hash_equals($plain, $password);
    }

    public function isEnabled(): bool
    {
        return $this->config->nullableString('auth.password_hash') !== null
            || $this->config->string('auth.password', '') !== '';
    }
}
