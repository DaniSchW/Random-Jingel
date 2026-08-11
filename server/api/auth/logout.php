<?php
require_once __DIR__ . '/../../lib/db.php';
require_once __DIR__ . '/../../lib/response.php';
require_once __DIR__ . '/../../lib/auth.php';

rj_require_method('POST');

// Deliberately not rj_require_session() here: logging out with an
// already-invalid/expired token should still succeed from the client's
// point of view (it just clears its local token either way), so this
// re-parses the header directly instead of 401ing on a stale session.
$header = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
if ($header === '' && function_exists('apache_request_headers')) {
  $headers = apache_request_headers();
  $header = $headers['Authorization'] ?? $headers['authorization'] ?? '';
}
if (preg_match('/^Bearer\s+(.+)$/i', trim($header), $matches)) {
  $tokenHash = rj_hash_token($matches[1]);
  rj_db()->prepare('DELETE FROM sessions WHERE token_hash = ?')->execute([$tokenHash]);
}

rj_json_response(['ok' => true]);
