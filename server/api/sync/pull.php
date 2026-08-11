<?php
/* Returns every row (categories, jingles, language setting) belonging to
 * the authenticated user, shaped exactly like the Supabase REST responses
 * js/sync.js's rowToLocalCategory/rowToLocalJingle already expect
 * (snake_case keys, ISO 8601 timestamps) - so that mapping code needs no
 * changes, only the fetch layer around it does.
 */
require_once __DIR__ . '/../../lib/db.php';
require_once __DIR__ . '/../../lib/response.php';
require_once __DIR__ . '/../../lib/auth.php';

rj_require_method('GET');
$user = rj_require_session();
$db = rj_db();

$stmt = $db->prepare('SELECT * FROM categories WHERE user_id = ?');
$stmt->execute([$user['id']]);
$categories = array_map('rj_category_row_out', $stmt->fetchAll());

$stmt = $db->prepare('SELECT * FROM jingles WHERE user_id = ?');
$stmt->execute([$user['id']]);
$jingles = array_map('rj_jingle_row_out', $stmt->fetchAll());

$stmt = $db->prepare('SELECT language, updated_at FROM user_settings WHERE user_id = ?');
$stmt->execute([$user['id']]);
$languageRow = $stmt->fetch();
$language = $languageRow ? [
  'language' => $languageRow['language'],
  'updated_at' => rj_datetime_to_iso($languageRow['updated_at']),
] : null;

rj_json_response([
  'categories' => $categories,
  'jingles' => $jingles,
  'language' => $language,
]);

function rj_category_row_out(array $row): array {
  return [
    'id' => $row['id'],
    'user_id' => $row['user_id'],
    'name' => $row['name'],
    'color' => $row['color'],
    'sort_order' => (int) $row['sort_order'],
    'deleted' => (bool) $row['deleted'],
    'playback_mode' => $row['playback_mode'],
    'sequential_index' => (int) $row['sequential_index'],
    'created_at' => rj_datetime_to_iso($row['created_at']),
    'updated_at' => rj_datetime_to_iso($row['updated_at']),
  ];
}

function rj_jingle_row_out(array $row): array {
  return [
    'id' => $row['id'],
    'user_id' => $row['user_id'],
    'category_id' => $row['category_id'],
    'name' => $row['name'],
    'color' => $row['color'],
    'storage_path' => $row['storage_path'],
    'mime_type' => $row['mime_type'],
    'file_name' => $row['file_name'],
    'sort_order' => (int) $row['sort_order'],
    'trim_start' => $row['trim_start'] !== null ? (float) $row['trim_start'] : null,
    'trim_end' => $row['trim_end'] !== null ? (float) $row['trim_end'] : null,
    'hotkey' => $row['hotkey'],
    'source_note' => $row['source_note'],
    'deleted' => (bool) $row['deleted'],
    'deleted_at' => rj_datetime_to_iso($row['deleted_at']),
    'created_at' => rj_datetime_to_iso($row['created_at']),
    'updated_at' => rj_datetime_to_iso($row['updated_at']),
  ];
}
