<?php
/* Template for server/config.php - copy this file to server/config.php and
 * fill in real values. server/config.php is gitignored on purpose: unlike
 * js/config.js (which only ever holds public-safe keys protected by
 * Supabase Row Level Security), DB_PASS here is a real MySQL password with
 * no such protection - it must never be committed or reach the browser.
 *
 * All-Inkl convention: DB_HOST is usually "localhost" from within their own
 * PHP hosting, and DB_USER is usually identical to DB_NAME. Confirm both in
 * KAS (Kunden-Administrations-System) if unsure.
 */

return [
  'DB_HOST' => 'localhost',
  'DB_NAME' => 'd047e762',
  'DB_USER' => 'd047e762',
  'DB_PASS' => 'change-me',

  // Used to build the magic-link URL emailed to users, e.g.
  // "https://app.random-jingle.com". No trailing slash.
  'APP_BASE_URL' => 'https://app.random-jingle.com',

  // From-address for magic-link emails (plain PHP mail(), no SMTP
  // credentials configured - see server/lib/mail.php for the tradeoffs).
  'MAIL_FROM' => 'service@web-schwarz.de',
  'MAIL_FROM_NAME' => 'Random Jingle',

  'AUTH_TOKEN_TTL_MINUTES' => 30,
  'SESSION_TTL_DAYS' => 90,

  // When true, request-link.php includes the raw magic-link token in its
  // JSON response instead of only emailing it. NEVER enable this in
  // production - it exists purely so the login flow can be tested end to
  // end (including by automated tests) without a working mail transport.
  'DEBUG_EXPOSE_TOKEN' => false,
];
