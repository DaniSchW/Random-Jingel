/* Committed on purpose - none of these are secrets. API_BASE_URL points at
 * the self-hosted PHP backend (server/api/) that replaced Supabase; the
 * backend itself holds the real, private MySQL credentials in
 * server/config.php, which is gitignored and never reaches the client.
 * Leave API_BASE_URL empty ("") to run fully offline/local-only, same as
 * leaving SUPABASE_URL empty used to.
 *
 * FREESOUND_API_KEY is a read-only Freesound "token" key (search + preview
 * playback only, no OAuth2 login involved) — with no backend to hide it
 * behind, it necessarily ships in client-side JS. Worst case if someone
 * extracts and reuses it is Freesound rate-limiting requests against this
 * specific app's Freesound account, not access to anything private. Leave
 * it empty ("") to keep the Sound-Effects tab hidden entirely.
 *
 * JAMENDO_CLIENT_ID is the public app identifier Jamendo's API requires on
 * every request (https://developer.jamendo.com/v3.0) — not a secret, no
 * OAuth2 involved for search/streaming. Leave it empty to keep the Music
 * tab hidden entirely. Free client_id: https://devportal.jamendo.com/
 */
window.RJ_CONFIG = {
  "API_BASE_URL": "/server/api",
  "FREESOUND_API_KEY": "kjFgYPaUtNOMakFWpq5FOtO04xtShhSApAUB91FC",
  "JAMENDO_CLIENT_ID": "1ce2becb"
};
