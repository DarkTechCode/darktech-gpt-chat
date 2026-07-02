<?php

declare(strict_types=1);

namespace GptImages;

use RuntimeException;

final class ResponsesTransport
{
    private $config;

    public function __construct(Config $config)
    {
        $this->config = $config;
    }

    public function post(string $endpoint, array $payload): string
    {
        $token = $this->apiToken();
        $url = $this->apiUrl($endpoint);
        $json = $this->encodedPayload($payload);

        if (function_exists('curl_init')) {
            return $this->postWithCurl($url, $json, $token);
        }

        return $this->postWithStreams($url, $json, $token);
    }

    public function postMany(string $endpoint, array $payloads): array
    {
        if (count($payloads) === 1) {
            return [$this->post($endpoint, $payloads[0])];
        }

        if (function_exists('curl_init') && function_exists('curl_multi_init') && function_exists('curl_multi_exec')) {
            return $this->postManyWithCurlMulti($endpoint, $payloads);
        }

        return $this->postSequentially($endpoint, $payloads);
    }

    private function postWithCurl(string $url, string $json, string $token): string
    {
        $curl = $this->curlHandle($url, $json, $token);

        $body = curl_exec($curl);
        $status = (int) curl_getinfo($curl, CURLINFO_HTTP_CODE);
        $error = curl_error($curl);
        curl_close($curl);

        if ($body === false) {
            throw new RuntimeException('API request failed: ' . $error);
        }

        if ($status >= 400) {
            throw new RuntimeException('API HTTP ' . $status . ': ' . $this->shortBody((string) $body));
        }

        return (string) $body;
    }

    private function postManyWithCurlMulti(string $endpoint, array $payloads): array
    {
        $token = $this->apiToken();
        $url = $this->apiUrl($endpoint);
        $multi = curl_multi_init();

        if ($multi === false) {
            return $this->postSequentially($endpoint, $payloads);
        }

        $handles = [];

        try {
            foreach ($payloads as $index => $payload) {
                $handle = $this->curlHandle($url, $this->encodedPayload($payload), $token);
                $handles[$index] = $handle;
                $status = curl_multi_add_handle($multi, $handle);

                if ($status !== CURLM_OK) {
                    throw new RuntimeException('API parallel request failed: ' . curl_multi_strerror($status));
                }
            }

            $active = 0;

            do {
                $status = curl_multi_exec($multi, $active);

                if ($status !== CURLM_OK) {
                    throw new RuntimeException('API parallel request failed: ' . curl_multi_strerror($status));
                }

                if ($active > 0) {
                    $selected = curl_multi_select($multi, 1.0);

                    if ($selected === -1) {
                        usleep(100000);
                    }
                }
            } while ($active > 0);

            $responses = [];

            foreach ($handles as $index => $handle) {
                $body = curl_multi_getcontent($handle);
                $status = (int) curl_getinfo($handle, CURLINFO_HTTP_CODE);
                $errorNumber = curl_errno($handle);
                $error = curl_error($handle);

                if ($errorNumber !== 0) {
                    throw new RuntimeException('API request failed: ' . $error);
                }

                if ($status >= 400) {
                    throw new RuntimeException('API HTTP ' . $status . ': ' . $this->shortBody((string) $body));
                }

                $responses[$index] = (string) $body;
            }

            ksort($responses);

            return array_values($responses);
        } finally {
            foreach ($handles as $handle) {
                curl_multi_remove_handle($multi, $handle);
                curl_close($handle);
            }

            curl_multi_close($multi);
        }
    }

    private function postSequentially(string $endpoint, array $payloads): array
    {
        $responses = [];

        foreach ($payloads as $payload) {
            $responses[] = $this->post($endpoint, $payload);
        }

        return $responses;
    }

    private function postWithStreams(string $url, string $json, string $token): string
    {
        $context = stream_context_create([
            'http' => [
                'method' => 'POST',
                'timeout' => $this->config->integer('api.timeout_seconds', 300),
                'header' => "Authorization: Bearer {$token}\r\nContent-Type: application/json\r\n",
                'content' => $json,
                'ignore_errors' => true,
            ],
        ]);

        $body = file_get_contents($url, false, $context);
        $status = 0;

        foreach ($http_response_header ?? [] as $header) {
            if (preg_match('/^HTTP\/\S+\s+(\d+)/', $header, $matches) === 1) {
                $status = (int) $matches[1];
                break;
            }
        }

        if ($body === false) {
            throw new RuntimeException('API request failed.');
        }

        if ($status >= 400) {
            throw new RuntimeException('API HTTP ' . $status . ': ' . $this->shortBody((string) $body));
        }

        return (string) $body;
    }

    private function shortBody(string $body): string
    {
        $body = trim($body);

        if (function_exists('mb_substr')) {
            return mb_substr($body, 0, 800, 'UTF-8');
        }

        return substr($body, 0, 800);
    }

    private function apiToken(): string
    {
        $token = $this->config->string('api.token');

        if ($token === '' || $token === 'sk-...') {
            throw new RuntimeException('API token is not configured in config.php.');
        }

        return $token;
    }

    private function apiUrl(string $endpoint): string
    {
        return rtrim($this->config->string('api.base_url'), '/') . $endpoint;
    }

    private function encodedPayload(array $payload): string
    {
        $json = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

        if ($json === false) {
            throw new RuntimeException('Unable to encode API request.');
        }

        return $json;
    }

    private function curlHandle(string $url, string $json, string $token)
    {
        $curl = curl_init($url);

        if ($curl === false) {
            throw new RuntimeException('Unable to initialize curl.');
        }

        curl_setopt_array($curl, [
            CURLOPT_POST => true,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER => [
                'Authorization: Bearer ' . $token,
                'Content-Type: application/json',
            ],
            CURLOPT_POSTFIELDS => $json,
            CURLOPT_TIMEOUT => $this->config->integer('api.timeout_seconds', 300),
        ]);

        return $curl;
    }
}
