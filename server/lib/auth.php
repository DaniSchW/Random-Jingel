<?php
/* Session/token handling. There is no Row Level Security here like there
 * was in Supabase - every protected endpoint MUST call rj_require_session()
 * and then filter every query by the returned user's id. That filtering is
 * the entire security boundary now.
 */

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/response.php';

function rj_generate_token(): string {
  return bin2hex(random_bytes(32));
}

function rj_hash_token(string $token): string {
  return hash('sha256', $token);
}

// Returns the authenticated user's row (id, email, role) or ends the
// request with 401. Reads "Authorization: Bearer <token>".
function rj_require_session(): array {
  $header = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
  if ($header === '' && function_exists('apache_request_headers')) {
    $headers = apache_request_headers();
    $header = $headers['Authorization'] ?? $headers['authorization'] ?? '';
  }
  if (!preg_match('/^Bearer\s+(.+)$/i', trim($header), $matches)) {
    rj_json_error('unauthorized', 401);
  }
  $tokenHash = rj_hash_token($matches[1]);

  $stmt = rj_db()->prepare(
    'SELECT u.id, u.email, u.role FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > UTC_TIMESTAMP()'
  );
  $stmt->execute([$tokenHash]);
  $user = $stmt->fetch();
  if (!$user) {
    rj_json_error('unauthorized', 401);
  }
  return $user;
}

function rj_require_admin(): array {
  $user = rj_require_session();
  if ($user['role'] !== 'admin') {
    rj_json_error('forbidden', 403);
  }
  return $user;
}

// Sliding-window rate limit: at most $max events per $windowSeconds for a
// given bucket key (e.g. "email:foo@bar.com" or "ip:1.2.3.4"). Records
// this attempt regardless of outcome, then prunes old rows for the bucket
// so auth_rate_limits doesn't grow unbounded.
function rj_check_rate_limit(string $bucketKey, int $max, int $windowSeconds): bool {
  $db = rj_db();
  $db->prepare('DELETE FROM auth_rate_limits WHERE bucket_key = ? AND created_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? SECOND)')
    ->execute([$bucketKey, $windowSeconds]);

  $stmt = $db->prepare('SELECT COUNT(*) AS n FROM auth_rate_limits WHERE bucket_key = ?');
  $stmt->execute([$bucketKey]);
  $count = (int) $stmt->fetch()['n'];

  if ($count >= $max) return false;

  $db->prepare('INSERT INTO auth_rate_limits (bucket_key) VALUES (?)')->execute([$bucketKey]);
  return true;
}

function rj_client_ip(): string {
  return $_SERVER['REMOTE_ADDR'] ?? 'unknown';
}
