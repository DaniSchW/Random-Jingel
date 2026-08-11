<?php
/* JSON in, JSON out helpers shared by every endpoint. */

function rj_json_body(): array {
  $raw = file_get_contents('php://input');
  if ($raw === '' || $raw === false) return [];
  $data = json_decode($raw, true);
  if (!is_array($data)) {
    rj_json_error('invalid_json', 400);
  }
  return $data;
}

function rj_json_response($data, int $status = 200): void {
  http_response_code($status);
  header('Content-Type: application/json; charset=utf-8');
  echo json_encode($data);
  exit;
}

function rj_json_error(string $code, int $status = 400, string $message = ''): void {
  rj_json_response(['error' => $code, 'message' => $message ?: $code], $status);
}

function rj_require_method(string $method): void {
  if (($_SERVER['REQUEST_METHOD'] ?? '') !== $method) {
    rj_json_error('method_not_allowed', 405);
  }
}
