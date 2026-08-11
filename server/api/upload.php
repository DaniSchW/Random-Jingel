<?php
/* Multipart audio upload. Called BEFORE the jingle row push (mirrors the
 * original uploadAudio()-then-upsert order in js/sync.js), so the jingle
 * row may or may not exist in the DB yet at this point - only refuse the
 * upload if it exists and belongs to someone else.
 */
require_once __DIR__ . '/../lib/db.php';
require_once __DIR__ . '/../lib/response.php';
require_once __DIR__ . '/../lib/auth.php';

rj_require_method('POST');
$user = rj_require_session();

$jingleId = (string)($_POST['jingle_id'] ?? '');
if ($jingleId === '' || !preg_match('/^[0-9a-fA-F-]{36}$/', $jingleId)) {
  rj_json_error('invalid_jingle_id', 400);
}

$db = rj_db();
$stmt = $db->prepare('SELECT user_id FROM jingles WHERE id = ?');
$stmt->execute([$jingleId]);
$existing = $stmt->fetch();
if ($existing && $existing['user_id'] !== $user['id']) {
  rj_json_error('forbidden', 403);
}

if (!isset($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
  rj_json_error('upload_failed', 400);
}
$file = $_FILES['file'];

$maxBytes = 30 * 1024 * 1024; // 30 MB - generous for a soundboard jingle
if ($file['size'] > $maxBytes) {
  rj_json_error('file_too_large', 413, 'Datei darf maximal 30 MB groß sein.');
}

$mimeType = $file['type'] ?: 'application/octet-stream';
$fileName = $file['name'] ?? '';

function rj_ext_from_filename(string $fileName): ?string {
  $dot = strrpos($fileName, '.');
  return $dot === false ? null : strtolower(substr($fileName, $dot + 1));
}

function rj_ext_from_mime(string $mime): ?string {
  $map = [
    'audio/mpeg' => 'mp3', 'audio/mp3' => 'mp3',
    'audio/wav' => 'wav', 'audio/x-wav' => 'wav', 'audio/wave' => 'wav',
    'audio/mp4' => 'm4a', 'audio/aac' => 'aac',
    'audio/ogg' => 'ogg', 'audio/webm' => 'weba',
  ];
  return $map[$mime] ?? null;
}

$ext = rj_ext_from_filename($fileName) ?: (rj_ext_from_mime($mimeType) ?: 'audio');
// Whitelist the extension itself too - it ends up in a filesystem path.
if (!preg_match('/^[a-z0-9]{1,10}$/', $ext)) {
  rj_json_error('invalid_extension', 400);
}

$userDir = __DIR__ . '/../uploads/' . $user['id'];
if (!is_dir($userDir) && !mkdir($userDir, 0750, true) && !is_dir($userDir)) {
  rj_json_error('storage_error', 500);
}

$storagePath = $user['id'] . '/' . $jingleId . '.' . $ext;
$destination = __DIR__ . '/../uploads/' . $storagePath;

if (!move_uploaded_file($file['tmp_name'], $destination)) {
  rj_json_error('storage_error', 500);
}

rj_json_response(['storage_path' => $storagePath, 'mime_type' => $mimeType, 'file_name' => $fileName]);
