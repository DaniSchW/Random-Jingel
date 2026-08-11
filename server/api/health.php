<?php
/* Visit /server/api/health.php in a browser after deploying to check
 * whether server/config.php's DB credentials actually work on this
 * hosting - this repo's sandbox has no way to verify that against the
 * real All-Inkl database, so this exists to make that check a URL visit
 * instead of digging through PHP error logs. No auth required on purpose
 * (there's no session system to check yet if the DB itself is broken);
 * it reveals no secrets, only whether the connection and schema look
 * right.
 */
require_once __DIR__ . '/../lib/db.php';
require_once __DIR__ . '/../lib/response.php';

rj_require_method('GET');

$result = ['ok' => true, 'checks' => []];

try {
  $db = rj_db();
  $result['checks']['db_connection'] = 'ok';
} catch (Throwable $e) {
  $result['ok'] = false;
  $result['checks']['db_connection'] = 'FAILED: ' . $e->getMessage();
  rj_json_response($result, 500);
}

$expectedTables = ['users', 'sessions', 'auth_tokens', 'auth_rate_limits', 'categories', 'jingles', 'user_settings'];
try {
  $stmt = $db->query('SHOW TABLES');
  $existing = $stmt->fetchAll(PDO::FETCH_COLUMN);
  $missing = array_values(array_diff($expectedTables, $existing));
  if ($missing) {
    $result['ok'] = false;
    $result['checks']['schema'] = 'FAILED: missing tables - ' . implode(', ', $missing) . '. Did you run server/schema.sql?';
  } else {
    $result['checks']['schema'] = 'ok (' . count($existing) . ' tables found)';
  }
} catch (Throwable $e) {
  $result['ok'] = false;
  $result['checks']['schema'] = 'FAILED: ' . $e->getMessage();
}

$uploadsDir = __DIR__ . '/../uploads';
$result['checks']['uploads_dir_writable'] = is_writable($uploadsDir) ? 'ok' : 'FAILED: ' . $uploadsDir . ' is not writable by PHP';
if (!is_writable($uploadsDir)) $result['ok'] = false;

$mailAvailable = function_exists('mail');
$result['checks']['mail_function_available'] = $mailAvailable ? 'ok (this only means mail() exists, not that delivery works)' : 'FAILED: mail() is not available';

rj_json_response($result, $result['ok'] ? 200 : 500);
