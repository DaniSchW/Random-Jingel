/*
 * Template only — not loaded by index.html.
 * The real js/config.js is generated from .env by `npm run config`
 * (see scripts/gen-config.js) and IS committed to the repo — its values
 * (a Supabase project URL and public/publishable key) are meant to be
 * public, and a static site with no build step needs them checked in for
 * every production deploy to actually have them. If you fork this project
 * for your own Supabase project, copy this file's shape into js/config.js
 * to swap in your own values.
 */
window.RJ_CONFIG = {
  SUPABASE_URL: 'https://your-project-ref.supabase.co',
  SUPABASE_ANON_KEY: 'your-anon-public-key',
};
