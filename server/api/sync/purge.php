<?php
/* Hard-deletes jingle rows (+ their audio file on disk) that the client
 * has already expired out of its local trash (24h). Mirrors the original
 * purgeExpiredTrash()'s per-item `removeAudio()` + `.delete()` calls.
 * Never trusts the id list alone - every id is re-checked to actually
 * belong to the caller before anything is removed.
 */
require_once __DIR__ . '/../../lib/db.php';
require_once __DIR__ . '/../../lib/response.php';
require_once __DIR__ . '/../../lib/auth.php';

rj_require_method('POST');
$user = rj_require_session();
$db = rj_db();

$body = rj_json_body();
$ids = $body['ids'] ?? [];
if (!is_array($ids)) {
  rj_json_error('invalid_ids', 400);
}

$purged = [];
foreach ($ids as $id) {
  if (!is_string($id) || $id === '') continue;

  $stmt = $db->prepare('SELECT storage_path FROM jingles WHERE id = ? AND user_id = ?');
  $stmt->execute([$id, $user['id']]);
  $row = $stmt->fetch();
  if (!$row) continue; // not found, or belongs to someone else - silently skip either way

  if (!empty($row['storage_path'])) {
    $path = realpath(__DIR__ . '/../../uploads/' . $row['storage_path']);
    $uploadsRoot = realpath(__DIR__ . '/../../uploads');
    // Confirm the resolved path is actually still inside uploads/ before
    // unlinking - storage_path is expected to always be "<user_id>/<id>.ext"
    // (see upload.php), but this guards against any unexpected value
    // (e.g. containing "..") ever reaching unlink().
    if ($path !== false && $uploadsRoot !== false && str_starts_with($path, $uploadsRoot . DIRECTORY_SEPARATOR)) {
      @unlink($path);
    }
  }

  $db->prepare('DELETE FROM jingles WHERE id = ? AND user_id = ?')->execute([$id, $user['id']]);
  $purged[] = $id;
}

rj_json_response(['purged' => $purged]);
