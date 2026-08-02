/* Search for royalty-free sound effects (Freesound) and music (Jamendo) as
 * an alternative to manually uploading a file when creating a jingle.
 * Read-only: only ever searches and fetches preview/stream audio, never
 * uploads/rates/logs in.
 *
 * Every entry point here is self-contained and never throws past its own
 * call site -- a missing API key, being offline, or the remote API being
 * unreachable all degrade to "section hidden" or "empty results with a
 * console.warn", exactly like js/ads.js's resilience pattern. This must
 * never be able to take the rest of the jingle-creation flow down with it.
 *
 * The two sources have genuinely different licensing shapes, surfaced via
 * each result's `license` field rather than papered over:
 *  - Freesound results are filtered to CC0 only (public domain, no
 *    attribution needed) -- see isCC0() below.
 *  - Jamendo tracks are Creative Commons but the exact variant (BY, BY-SA,
 *    BY-NC, ...) differs per track and is NOT filtered; the actual
 *    license URL Jamendo reports is passed through unfiltered so it can be
 *    stored as the jingle's permanent source hint later.
 */
const RJMediaSearch = (() => {
  const FREESOUND_SEARCH_URL = 'https://freesound.org/apiv2/search/text/';
  const FREESOUND_FIELDS = 'id,name,duration,previews,license,username,url';
  const PAGE_SIZE = 15;

  const JAMENDO_SEARCH_URL = 'https://api.jamendo.com/v3.0/tracks/';

  function freesoundApiKey() {
    const cfg = window.RJ_CONFIG;
    return (cfg && cfg.FREESOUND_API_KEY) || '';
  }

  function jamendoClientId() {
    const cfg = window.RJ_CONFIG;
    return (cfg && cfg.JAMENDO_CLIENT_ID) || '';
  }

  function soundEffectsAvailable() {
    return !!freesoundApiKey() && navigator.onLine;
  }

  function musicAvailable() {
    return !!jamendoClientId() && navigator.onLine;
  }

  // Defense in depth on top of the server-side `filter=license:"Creative
  // Commons 0"` query param: only ever surface a result whose license URL
  // is actually the CC0 one, regardless of whether the filter syntax above
  // is exactly right server-side. Keeps the "gemafrei, keine Namensnennung
  // nötig" promise even if Freesound's filter behaves unexpectedly.
  function isCC0(licenseUrl) {
    return typeof licenseUrl === 'string' && licenseUrl.includes('publicdomain/zero');
  }

  function normalizeFreesoundResult(raw) {
    const previews = raw.previews || {};
    const previewUrl = previews['preview-hq-mp3'] || previews['preview-lq-mp3'] || null;
    if (!previewUrl) return null;
    return {
      id: `freesound-${raw.id}`,
      title: raw.name || '',
      durationSeconds: typeof raw.duration === 'number' ? raw.duration : 0,
      previewUrl,
      sourceLabel: 'Freesound',
      sourceUrl: raw.url || null,
      license: raw.license || null,
    };
  }

  // Returns { results: [...] } on success, or { error: true, reason } on
  // any failure -- never rejects/throws, so callers can render an inline
  // "keine Treffer" / error state without a try/catch of their own.
  async function searchSoundEffects(query) {
    const key = freesoundApiKey();
    if (!key) return { error: true, reason: 'unconfigured' };
    if (!navigator.onLine) return { error: true, reason: 'offline' };
    if (!query || !query.trim()) return { results: [] };

    const url = new URL(FREESOUND_SEARCH_URL);
    url.searchParams.set('query', query.trim());
    url.searchParams.set('token', key);
    url.searchParams.set('fields', FREESOUND_FIELDS);
    url.searchParams.set('filter', 'license:"Creative Commons 0"');
    url.searchParams.set('page_size', String(PAGE_SIZE));

    try {
      const res = await fetch(url.toString());
      if (!res.ok) {
        console.warn(`Freesound-Suche fehlgeschlagen (HTTP ${res.status})`);
        return { error: true, reason: 'http', status: res.status };
      }
      const data = await res.json();
      const results = (data.results || [])
        .filter((raw) => isCC0(raw.license))
        .map(normalizeFreesoundResult)
        .filter(Boolean);
      return { results };
    } catch (err) {
      console.warn('Freesound-Suche fehlgeschlagen', err);
      return { error: true, reason: 'network' };
    }
  }

  function normalizeJamendoResult(raw) {
    if (!raw.audio) return null;
    return {
      id: `jamendo-${raw.id}`,
      title: raw.artist_name ? `${raw.name} — ${raw.artist_name}` : (raw.name || ''),
      durationSeconds: typeof raw.duration === 'number' ? raw.duration : 0,
      previewUrl: raw.audio,
      sourceLabel: 'Jamendo',
      sourceUrl: raw.shareurl || raw.shorturl || null,
      license: raw.license_ccurl || null,
    };
  }

  // Same {results:[...]} / {error:true, reason} contract as
  // searchSoundEffects() above.
  async function searchMusic(query) {
    const clientId = jamendoClientId();
    if (!clientId) return { error: true, reason: 'unconfigured' };
    if (!navigator.onLine) return { error: true, reason: 'offline' };
    if (!query || !query.trim()) return { results: [] };

    const url = new URL(JAMENDO_SEARCH_URL);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('format', 'json');
    url.searchParams.set('search', query.trim());
    url.searchParams.set('limit', String(PAGE_SIZE));
    url.searchParams.set('include', 'musicinfo');

    try {
      const res = await fetch(url.toString());
      if (!res.ok) {
        console.warn(`Jamendo-Suche fehlgeschlagen (HTTP ${res.status})`);
        return { error: true, reason: 'http', status: res.status };
      }
      const data = await res.json();
      const results = (data.results || []).map(normalizeJamendoResult).filter(Boolean);
      return { results };
    } catch (err) {
      console.warn('Jamendo-Suche fehlgeschlagen', err);
      return { error: true, reason: 'network' };
    }
  }

  // Turns a Creative Commons license URL into a short label for the
  // permanent per-jingle source hint, e.g.:
  //   https://creativecommons.org/publicdomain/zero/1.0/        -> "CC0"
  //   https://creativecommons.org/licenses/by-nc-nd/3.0/         -> "CC BY-NC-ND"
  // Returns '' for anything unrecognized rather than guessing.
  function shortLicenseLabel(licenseUrl) {
    if (typeof licenseUrl !== 'string') return '';
    if (licenseUrl.includes('publicdomain/zero')) return 'CC0';
    const m = licenseUrl.match(/licenses\/([a-z-]+)\//i);
    return m ? `CC ${m[1].toUpperCase()}` : '';
  }

  return {
    soundEffectsAvailable,
    searchSoundEffects,
    musicAvailable,
    searchMusic,
    shortLicenseLabel,
  };
})();
