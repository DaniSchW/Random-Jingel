<?php
/* Upserts exactly one row (category, jingle, or the language setting) per
 * call - mirrors the original pushDirty()'s per-item upsert loop in
 * js/sync.js almost 1:1, just as an HTTP call instead of a supabase-js
 * call. Kept per-row (not batched) so that loop's existing per-item
 * try/catch and dirty-clearing logic barely has to change.
 *
 * There is no Row Level Security here. Every write below explicitly pins
 * user_id to the authenticated session and, for a row that already
 * exists, refuses to touch it if it belongs to someone else - that check
 * IS the security boundary that RLS used to provide for free.
 */
require_once __DIR__ . '/../../lib/db.php';
require_once __DIR__ . '/../../lib/response.php';
require_once __DIR__ . '/../../lib/auth.php';

rj_require_method('POST');
$user = rj_require_session();
$db = rj_db();

$body = rj_json_body();
$kind = $body['kind'] ?? '';
$row = $body['row'] ?? null;
if (!is_array($row)) {
  rj_json_error('invalid_row', 400);
}

switch ($kind) {
  case 'category':
    rj_push_category($db, $user['id'], $row);
    break;
  case 'jingle':
    rj_push_jingle($db, $user['id'], $row);
    break;
  case 'language':
    rj_push_language($db, $user['id'], $row);
    break;
  default:
    rj_json_error('invalid_kind', 400);
}

rj_json_response(['ok' => true]);

// Returns the owning user_id of an existing row, or null if it doesn't
// exist yet. Used to refuse cross-user overwrites before every upsert.
function rj_existing_owner(PDO $db, string $table, string $id): ?string {
  $stmt = $db->prepare("SELECT user_id FROM {$table} WHERE id = ?");
  $stmt->execute([$id]);
  $row = $stmt->fetch();
  return $row ? $row['user_id'] : null;
}

function rj_push_category(PDO $db, string $userId, array $row): void {
  $id = (string)($row['id'] ?? '');
  if ($id === '') rj_json_error('missing_id', 400);

  $owner = rj_existing_owner($db, 'categories', $id);
  if ($owner !== null && $owner !== $userId) {
    rj_json_error('forbidden', 403, 'Diese Kategorie gehört einem anderen Konto.');
  }

  $playbackMode = ($row['playback_mode'] ?? 'random') === 'sequential' ? 'sequential' : 'random';

  $stmt = $db->prepare(
    'INSERT INTO categories (id, user_id, name, color, sort_order, deleted, playback_mode, sequential_index, created_at, updated_at)
     VALUES (:id, :user_id, :name, :color, :sort_order, :deleted, :playback_mode, :sequential_index, :created_at, :updated_at)
     ON DUPLICATE KEY UPDATE
       name = VALUES(name), color = VALUES(color), sort_order = VALUES(sort_order),
       deleted = VALUES(deleted), playback_mode = VALUES(playback_mode),
       sequential_index = VALUES(sequential_index), updated_at = VALUES(updated_at)'
  );
  $stmt->execute([
    'id' => $id,
    'user_id' => $userId,
    'name' => (string)($row['name'] ?? ''),
    'color' => (string)($row['color'] ?? ''),
    'sort_order' => (int)($row['sort_order'] ?? 0),
    'deleted' => !empty($row['deleted']) ? 1 : 0,
    'playback_mode' => $playbackMode,
    'sequential_index' => (int)($row['sequential_index'] ?? 0),
    'created_at' => rj_iso_to_datetime($row['created_at'] ?? null) ?? rj_ms_to_datetime((int)(microtime(true) * 1000)),
    'updated_at' => rj_iso_to_datetime($row['updated_at'] ?? null) ?? rj_ms_to_datetime((int)(microtime(true) * 1000)),
  ]);
}

function rj_push_jingle(PDO $db, string $userId, array $row): void {
  $id = (string)($row['id'] ?? '');
  $categoryId = (string)($row['category_id'] ?? '');
  if ($id === '' || $categoryId === '') rj_json_error('missing_id', 400);

  $owner = rj_existing_owner($db, 'jingles', $id);
  if ($owner !== null && $owner !== $userId) {
    rj_json_error('forbidden', 403, 'Dieser Jingle gehört einem anderen Konto.');
  }

  // The category must exist and belong to this user - mirrors the FK +
  // RLS combination Postgres enforced automatically before.
  $categoryOwner = rj_existing_owner($db, 'categories', $categoryId);
  if ($categoryOwner !== $userId) {
    rj_json_error('invalid_category', 400, 'Kategorie existiert nicht oder gehört einem anderen Konto.');
  }

  $now = rj_ms_to_datetime((int)(microtime(true) * 1000));
  $stmt = $db->prepare(
    'INSERT INTO jingles (id, user_id, category_id, name, color, storage_path, mime_type, file_name, sort_order,
       trim_start, trim_end, hotkey, source_note, deleted, deleted_at, created_at, updated_at)
     VALUES (:id, :user_id, :category_id, :name, :color, :storage_path, :mime_type, :file_name, :sort_order,
       :trim_start, :trim_end, :hotkey, :source_note, :deleted, :deleted_at, :created_at, :updated_at)
     ON DUPLICATE KEY UPDATE
       category_id = VALUES(category_id), name = VALUES(name), color = VALUES(color),
       storage_path = VALUES(storage_path), mime_type = VALUES(mime_type), file_name = VALUES(file_name),
       sort_order = VALUES(sort_order), trim_start = VALUES(trim_start), trim_end = VALUES(trim_end),
       hotkey = VALUES(hotkey), source_note = VALUES(source_note), deleted = VALUES(deleted),
       deleted_at = VALUES(deleted_at), updated_at = VALUES(updated_at)'
  );
  $stmt->execute([
    'id' => $id,
    'user_id' => $userId,
    'category_id' => $categoryId,
    'name' => (string)($row['name'] ?? ''),
    'color' => $row['color'] ?? null,
    'storage_path' => $row['storage_path'] ?? null,
    'mime_type' => $row['mime_type'] ?? null,
    'file_name' => $row['file_name'] ?? null,
    'sort_order' => (int)($row['sort_order'] ?? 0),
    'trim_start' => isset($row['trim_start']) ? (float)$row['trim_start'] : null,
    'trim_end' => isset($row['trim_end']) ? (float)$row['trim_end'] : null,
    'hotkey' => $row['hotkey'] ?? null,
    'source_note' => $row['source_note'] ?? null,
    'deleted' => !empty($row['deleted']) ? 1 : 0,
    'deleted_at' => rj_iso_to_datetime($row['deleted_at'] ?? null),
    'created_at' => rj_iso_to_datetime($row['created_at'] ?? null) ?? $now,
    'updated_at' => rj_iso_to_datetime($row['updated_at'] ?? null) ?? $now,
  ]);
}

function rj_push_language(PDO $db, string $userId, array $row): void {
  $language = (string)($row['language'] ?? '');
  if ($language === '') rj_json_error('missing_language', 400);

  $updatedAt = rj_iso_to_datetime($row['updated_at'] ?? null) ?? rj_ms_to_datetime((int)(microtime(true) * 1000));
  $stmt = $db->prepare(
    'INSERT INTO user_settings (user_id, language, updated_at) VALUES (:user_id, :language, :updated_at)
     ON DUPLICATE KEY UPDATE language = VALUES(language), updated_at = VALUES(updated_at)'
  );
  $stmt->execute(['user_id' => $userId, 'language' => $language, 'updated_at' => $updatedAt]);
}
