/* i18n for Random Jingle.
 * Language files are plain JSON (i18n/de.json, i18n/en.json), fetched once
 * at startup and cached by the service worker so both languages keep
 * working offline after the first load. The chosen language is local-first
 * (IndexedDB meta store) and, when signed in, mirrored to Supabase by
 * RJSync the same way categories/jingles are — last write wins.
 */
const RJI18n = (() => {
  const SUPPORTED = ['de', 'en', 'nl', 'fr', 'da', 'pl', 'cs', 'it'];
  const FALLBACK = 'de';
  // BCP-47 locale for Date/Number formatting (toLocaleDateString etc.) per
  // supported language — separate from SUPPORTED because it's a display
  // detail, not a translation availability flag.
  const LOCALE_MAP = {
    de: 'de-DE',
    en: 'en-US',
    nl: 'nl-NL',
    fr: 'fr-FR',
    da: 'da-DK',
    pl: 'pl-PL',
    cs: 'cs-CZ',
    it: 'it-IT',
  };

  let current = FALLBACK;
  let dictionaries = {};
  const changeListeners = new Set();

  function detectBrowserLanguage() {
    const langs = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language];
    for (const lang of langs) {
      if (!lang) continue;
      const code = lang.slice(0, 2).toLowerCase();
      if (SUPPORTED.includes(code)) return code;
    }
    return FALLBACK;
  }

  async function loadDictionary(lang) {
    const res = await fetch(`i18n/${lang}.json`);
    if (!res.ok) throw new Error(`i18n: ${lang}.json konnte nicht geladen werden (${res.status})`);
    return res.json();
  }

  function getPath(obj, path) {
    return path.split('.').reduce((node, key) => (node && typeof node === 'object' ? node[key] : undefined), obj);
  }

  function interpolate(template, vars) {
    if (!vars) return template;
    return template.replace(/\{(\w+)\}/g, (match, key) => (key in vars ? String(vars[key]) : match));
  }

  function t(key, vars) {
    const dict = dictionaries[current] || {};
    const fallbackDict = dictionaries[FALLBACK] || {};
    const value = getPath(dict, key) ?? getPath(fallbackDict, key);
    if (value == null) {
      console.warn(`i18n: fehlender Key "${key}"`);
      return key;
    }
    return interpolate(value, vars);
  }

  // Plural helper: RJI18n.tCount('category.jingleCount', 3) -> "3 jingles"
  function tCount(baseKey, count, vars) {
    const suffix = count === 1 ? 'One' : 'Other';
    return t(`${baseKey}${suffix}`, { count, ...vars });
  }

  function applyStaticTranslations(root = document) {
    root.querySelectorAll('[data-i18n]').forEach((el) => {
      el.textContent = t(el.getAttribute('data-i18n'));
    });
    root.querySelectorAll('[data-i18n-html]').forEach((el) => {
      el.innerHTML = t(el.getAttribute('data-i18n-html'));
    });
    root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder')));
    });
    root.querySelectorAll('[data-i18n-title]').forEach((el) => {
      el.setAttribute('title', t(el.getAttribute('data-i18n-title')));
    });
    root.querySelectorAll('[data-i18n-aria-label]').forEach((el) => {
      el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria-label')));
    });
    document.documentElement.lang = current;
    const descMeta = document.querySelector('meta[name="description"]');
    if (descMeta) descMeta.setAttribute('content', t('app.description'));
  }

  function notifyChange() {
    for (const cb of changeListeners) cb(current);
  }

  function onChange(cb) {
    changeListeners.add(cb);
    return () => changeListeners.delete(cb);
  }

  // dirty:true means "changed locally, not yet pushed" — mirrors the
  // categories/jingles convention so RJSync can treat it the same way.
  async function setLanguage(lang, { persist = true, dirty = true } = {}) {
    const next = SUPPORTED.includes(lang) ? lang : FALLBACK;
    if (next === current) return;
    current = next;
    applyStaticTranslations();
    notifyChange();
    if (persist) {
      await RJDB.setMeta('language', {
        code: current,
        updatedAt: Date.now(),
        dirty,
      });
    }
  }

  function getLanguage() {
    return current;
  }

  function getLocale() {
    return LOCALE_MAP[current] || LOCALE_MAP[FALLBACK];
  }

  function getSupportedLanguages() {
    return SUPPORTED.slice();
  }

  async function init() {
    const loaded = await Promise.all(SUPPORTED.map((lang) => loadDictionary(lang)));
    dictionaries = Object.fromEntries(SUPPORTED.map((lang, i) => [lang, loaded[i]]));

    const stored = await RJDB.getMeta('language');
    if (stored && SUPPORTED.includes(stored.code)) {
      current = stored.code;
    } else {
      // First run: suggest the browser's language, but don't force it —
      // the user can change it any time in Settings. Stored as non-dirty
      // "auto" pick so it never overwrites an explicit remote preference
      // once signed in (see RJSync's language pull/LWW).
      current = detectBrowserLanguage();
      await RJDB.setMeta('language', { code: current, updatedAt: Date.now(), dirty: false, auto: true });
    }
    applyStaticTranslations();
  }

  return {
    init,
    t,
    tCount,
    setLanguage,
    getLanguage,
    getLocale,
    getSupportedLanguages,
    applyStaticTranslations,
    onChange,
  };
})();
