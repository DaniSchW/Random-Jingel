<?php
require_once __DIR__ . '/../../lib/db.php';
require_once __DIR__ . '/../../lib/response.php';
require_once __DIR__ . '/../../lib/auth.php';

rj_require_method('POST');

$body = rj_json_body();
$token = trim((string)($body['token'] ?? ''));
if ($token === '') {
  rj_json_error('invalid_token', 400);
}

$db = rj_db();
$tokenHash = rj_hash_token($token);

$db->beginTransaction();
try {
  $stmt = $db->prepare(
    'SELECT email FROM auth_tokens WHERE token_hash = ? AND used = 0 AND expires_at > UTC_TIMESTAMP() FOR UPDATE'
  );
  $stmt->execute([$tokenHash]);
  $row = $stmt->fetch();
  if (!$row) {
    $db->rollBack();
    rj_json_error('invalid_or_expired_token', 401);
  }
  $email = $row['email'];

  $db->prepare('UPDATE auth_tokens SET used = 1 WHERE token_hash = ?')->execute([$tokenHash]);

  // Find-or-create the user, mirroring Supabase OTP's default behavior:
  // any valid, verified email can sign in and gets an account on first use.
  $stmt = $db->prepare('SELECT id, email, role FROM users WHERE email = ?');
  $stmt->execute([$email]);
  $user = $stmt->fetch();
  if (!$user) {
    $userId = rj_uuid4();
    $db->prepare('INSERT INTO users (id, email) VALUES (?, ?)')->execute([$userId, $email]);
    $user = ['id' => $userId, 'email' => $email, 'role' => 'user'];
  }

  $cfg = rj_config();
  $sessionToken = rj_generate_token();
  $sessionHash = rj_hash_token($sessionToken);
  $db->prepare(
    'INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? DAY))'
  )->execute([$sessionHash, $user['id'], (int) $cfg['SESSION_TTL_DAYS']]);

  $db->commit();
} catch (Exception $e) {
  $db->rollBack();
  throw $e;
}

rj_json_response([
  'session_token' => $sessionToken,
  'user' => ['id' => $user['id'], 'email' => $user['email'], 'role' => $user['role']],
]);
