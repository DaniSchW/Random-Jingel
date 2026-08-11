<?php
require_once __DIR__ . '/../../lib/db.php';
require_once __DIR__ . '/../../lib/response.php';
require_once __DIR__ . '/../../lib/auth.php';
require_once __DIR__ . '/../../lib/mail.php';

rj_require_method('POST');

$body = rj_json_body();
$email = trim((string)($body['email'] ?? ''));

if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 255) {
  rj_json_error('invalid_email', 400);
}

// Two independent buckets: a burst of requests for one address, or a burst
// from one IP hitting many addresses, both get throttled.
if (!rj_check_rate_limit('email:' . strtolower($email), 5, 3600)) {
  rj_json_error('rate_limited', 429, 'Zu viele Anfragen für diese E-Mail-Adresse. Bitte später erneut versuchen.');
}
if (!rj_check_rate_limit('ip:' . rj_client_ip(), 20, 3600)) {
  rj_json_error('rate_limited', 429, 'Zu viele Anfragen. Bitte später erneut versuchen.');
}

$cfg = rj_config();
$token = rj_generate_token();
$tokenHash = rj_hash_token($token);
$ttlMinutes = (int) $cfg['AUTH_TOKEN_TTL_MINUTES'];

$db = rj_db();
$db->prepare(
  'INSERT INTO auth_tokens (token_hash, email, expires_at) VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? MINUTE))'
)->execute([$tokenHash, strtolower($email), $ttlMinutes]);

$link = rtrim($cfg['APP_BASE_URL'], '/') . '/?token=' . urlencode($token);
$mailSent = rj_send_magic_link_email($email, $link);

$response = ['ok' => true];
if (!empty($cfg['DEBUG_EXPOSE_TOKEN'])) {
  // Sandbox/dev only - see the warning on this flag in config.example.php.
  $response['debug_token'] = $token;
  $response['debug_link'] = $link;
  $response['debug_mail_sent'] = $mailSent;
}
rj_json_response($response);
