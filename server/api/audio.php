<?php
/* Streams back a jingle's audio file after checking the caller actually
 * owns it. This is the only legitimate way to read anything under
 * server/uploads/ - that directory's own .htaccess denies direct HTTP
 * access entirely (see server/uploads/.htaccess).
 */
require_once __DIR__ . '/../lib/db.php';
require_once __DIR__ . '/../lib/response.php';
require_once __DIR__ . '/../lib/auth.php';

rj_require_method('GET');
$user = rj_require_session();

$path = (string)($_GET['path'] ?? '');
// storage_path is always "<user_id>/<jingle_id>.<ext>" (see upload.php) -
// requiring it to start with the caller's own id rejects any attempt to
// probe another user's files before a single query even runs.
if ($path === '' || !str_starts_with($path, $user['id'] . '/')) {
  rj_json_error('forbidden', 403);
}

$db = rj_db();
$stmt = $db->prepare('SELECT mime_type, file_name FROM jingles WHERE storage_path = ? AND user_id = ?');
$stmt->execute([$path, $user['id']]);
$row = $stmt->fetch();
if (!$row) {
  rj_json_error('not_found', 404);
}

$uploadsRoot = realpath(__DIR__ . '/../uploads');
$fullPath = realpath(__DIR__ . '/../uploads/' . $path);
if ($fullPath === false || $uploadsRoot === false || !str_starts_with($fullPath, $uploadsRoot . DIRECTORY_SEPARATOR)) {
  rj_json_error('not_found', 404);
}

header('Content-Type: ' . ($row['mime_type'] ?: 'application/octet-stream'));
header('Content-Length: ' . filesize($fullPath));
header('Cache-Control: private, max-age=31536000, immutable'); // content at a given path never changes once uploaded
header('Content-Disposition: inline; filename="' . addslashes($row['file_name'] ?: 'audio') . '"');
readfile($fullPath);
