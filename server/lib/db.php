<?php
/* Single shared PDO connection, built from server/config.php. Every query
 * anywhere in server/ must go through prepared statements on this handle -
 * there is no ORM here on purpose (small surface, easy to audit), but that
 * means string-interpolated SQL is never acceptable, not even for values
 * that "can't" be attacker-controlled.
 */

function rj_config(): array {
  static $config = null;
  if ($config === null) {
    $path = __DIR__ . '/../config.php';
    if (!file_exists($path)) {
      http_response_code(500);
      header('Content-Type: application/json');
      echo json_encode(['error' => 'server_not_configured']);
      exit;
    }
    $config = require $path;
  }
  return $config;
}

function rj_db(): PDO {
  static $pdo = null;
  if ($pdo === null) {
    $cfg = rj_config();
    $dsn = sprintf(
      'mysql:host=%s;dbname=%s;charset=utf8mb4',
      $cfg['DB_HOST'],
      $cfg['DB_NAME']
    );
    $pdo = new PDO($dsn, $cfg['DB_USER'], $cfg['DB_PASS'], [
      PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
      PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
      PDO::ATTR_EMULATE_PREPARES => false,
    ]);
  }
  return $pdo;
}

// UUIDv4, used for every id this backend generates server-side (users.id
// on first login). Client-generated ids (categories/jingles) already come
// in as UUIDs from crypto.randomUUID() and are passed through as-is.
function rj_uuid4(): string {
  $data = random_bytes(16);
  $data[6] = chr((ord($data[6]) & 0x0f) | 0x40);
  $data[8] = chr((ord($data[8]) & 0x3f) | 0x80);
  return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($data), 4));
}

// DATETIME(3) string in UTC, matching the millisecond-precision timestamps
// the client sends (Date.now() / new Date(ms).toISOString()).
function rj_ms_to_datetime(?int $ms): ?string {
  if ($ms === null) return null;
  $seconds = intdiv($ms, 1000);
  $millis = $ms % 1000;
  return gmdate('Y-m-d H:i:s', $seconds) . '.' . str_pad((string)$millis, 3, '0', STR_PAD_LEFT);
}

function rj_datetime_to_ms(?string $dt): ?int {
  if ($dt === null) return null;
  $parsed = DateTime::createFromFormat('Y-m-d H:i:s.u', $dt, new DateTimeZone('UTC'));
  if ($parsed === false) {
    $parsed = DateTime::createFromFormat('Y-m-d H:i:s', $dt, new DateTimeZone('UTC'));
  }
  if ($parsed === false) return null;
  return (int) round(((float) $parsed->format('U.u')) * 1000);
}
