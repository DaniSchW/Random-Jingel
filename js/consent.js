/* Ad-cookie consent for Random Jingle (Phase 4).
 * A tiny, purely local module: the decision is stored in an actual browser
 * cookie (the thing being consented to), never touches the network, and
 * works fully offline. Three states: null (no decision yet), 'granted',
 * 'denied'. app.js uses this to pick which ad placeholder to render —
 * AdSense only after explicit consent, EthicalAds (no tracking, no consent
 * required) otherwise.
 */
const RJConsent = (() => {
  const COOKIE_NAME = 'rj_ad_consent';
  const MAX_AGE_DAYS = 180;
  const listeners = new Set();

  function readCookie() {
    const match = document.cookie.match(new RegExp(`(?:^|; )${COOKIE_NAME}=([^;]*)`));
    const value = match ? decodeURIComponent(match[1]) : null;
    return value === 'granted' || value === 'denied' ? value : null;
  }

  function writeCookie(value) {
    const maxAgeSeconds = MAX_AGE_DAYS * 24 * 60 * 60;
    document.cookie = `${COOKIE_NAME}=${value}; max-age=${maxAgeSeconds}; path=/; SameSite=Lax`;
  }

  let current = readCookie();

  function getStatus() {
    return current; // null | 'granted' | 'denied'
  }

  function setStatus(value) {
    if (value !== 'granted' && value !== 'denied') return;
    current = value;
    writeCookie(value);
    for (const cb of listeners) cb(current);
  }

  function onChange(cb) {
    listeners.add(cb);
    return () => listeners.delete(cb);
  }

  return { getStatus, setStatus, onChange };
})();
