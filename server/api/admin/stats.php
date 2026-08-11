<?php
/* Mirrors Supabase's admin_user_stats() RPC: per-user email, signup date,
 * and non-deleted jingle count. Returns a plain JSON array (not wrapped
 * in an object) so js/sync.js's adminUserStats() can keep returning it
 * to app.js unchanged - app.js already expects exactly this shape.
 */
require_once __DIR__ . '/../../lib/db.php';
require_once __DIR__ . '/../../lib/response.php';
require_once __DIR__ . '/../../lib/auth.php';

rj_require_method('GET');
rj_require_admin(); // re-checks role server-side, same as the Supabase RPC did

$db = rj_db();
$stmt = $db->query(
  "SELECT u.id AS user_id, u.email, u.created_at,
          COUNT(j.id) AS jingle_count
   FROM users u
   LEFT JOIN jingles j ON j.user_id = u.id AND j.deleted = 0
   GROUP BY u.id, u.email, u.created_at
   ORDER BY u.created_at DESC"
);

$rows = array_map(function (array $row): array {
  return [
    'user_id' => $row['user_id'],
    'email' => $row['email'],
    'created_at' => rj_datetime_to_iso($row['created_at']),
    'jingle_count' => (int) $row['jingle_count'],
  ];
}, $stmt->fetchAll());

rj_json_response($rows);
