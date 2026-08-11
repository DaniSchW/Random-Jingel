<?php
/* Validates a persisted session token (from localStorage, sent on every
 * app load) and returns the current user info - including role, which
 * can change between logins (e.g. an admin promotion), so this is always
 * re-checked rather than trusted from whatever was cached client-side.
 */
require_once __DIR__ . '/../../lib/db.php';
require_once __DIR__ . '/../../lib/response.php';
require_once __DIR__ . '/../../lib/auth.php';

rj_require_method('GET');
$user = rj_require_session();

rj_json_response(['user' => $user]);
