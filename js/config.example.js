/*
 * Template only — not loaded by index.html.
 * The real js/config.js IS committed to the repo — API_BASE_URL is just a
 * path, not a secret (the actual DB credentials live server-side in
 * server/config.php, which is gitignored). If you fork this project and
 * host your own copy of server/, copy this file's shape into
 * js/config.js and point API_BASE_URL at wherever you deployed server/.
 */
window.RJ_CONFIG = {
  API_BASE_URL: '/server/api',
  // Optional: leave empty to hide the Sound-Effects search tab entirely.
  // Get a free key at https://freesound.org/apiv2/apply/
  FREESOUND_API_KEY: '',
  // Optional: leave empty to hide the Music search tab entirely.
  // Get a free client_id at https://devportal.jamendo.com/
  JAMENDO_CLIENT_ID: '',
};
