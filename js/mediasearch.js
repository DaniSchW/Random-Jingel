/* Search for royalty-free sound effects (Freesound) as an alternative to
 * manually uploading a file when creating a jingle. Read-only: only ever
 * searches and fetches preview audio, never uploads/rates/logs in.
 *
 * Every entry point here is self-contained and never throws past its own
 * call site -- a missing API key, being offline, or Freesound being
 * unreachable all degrade to "section hidden" or "empty results with a
 * console.warn", exactly like js/ads.js's resilience pattern. This must
 * never be able to take the rest of the jingle-creation flow down with it.
 */
const RJMediaSearch = (() => {
  const FREESOUND_SEARCH_URL = 'https://freesound.org/apiv2/search/text/';
  const FREESOUND_FIELDS = 'id,name,duration,previews,license,username,url';
  const PAGE_SIZE = 15;

  function freesoundApiKey() {
    const cfg = window.RJ_CONFIG;
    return (cfg && cfg.FREESOUND_API_KEY) || '';
  }

  function soundEffectsAvailable() {
    return !!freesoundApiKey() && navigator.onLine;
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

  return {
    soundEffectsAvailable,
    searchSoundEffects,
  };
})();
