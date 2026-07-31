/* i18n for the Random Jingle marketing site.
 * Standalone (no shared code with the app project): plain JSON dictionaries
 * fetched once at load, language choice kept in localStorage. Default is
 * German with the browser language used only as a first-visit suggestion,
 * mirroring the app's own i18n behavior.
 */
const RJSiteI18n = (() => {
  const SUPPORTED = ['de', 'en'];
  const FALLBACK = 'de';
  const STORAGE_KEY = 'rj-site-lang';

  let current = FALLBACK;
  let dictionaries = {};

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
    if (!res.ok) throw new Error(`i18n: ${lang}.json could not be loaded (${res.status})`);
    return res.json();
  }

  function getPath(obj, path) {
    return path.split('.').reduce((node, key) => (node && typeof node === 'object' ? node[key] : undefined), obj);
  }

  function t(key) {
    const dict = dictionaries[current] || {};
    const fallbackDict = dictionaries[FALLBACK] || {};
    const value = getPath(dict, key) ?? getPath(fallbackDict, key);
    if (value == null) {
      console.warn(`i18n: missing key "${key}"`);
      return key;
    }
    return value;
  }

  function applyStaticTranslations(root = document) {
    root.querySelectorAll('[data-i18n]').forEach((el) => {
      el.textContent = t(el.getAttribute('data-i18n'));
    });
    root.querySelectorAll('[data-i18n-html]').forEach((el) => {
      el.innerHTML = t(el.getAttribute('data-i18n-html'));
    });
    root.querySelectorAll('[data-i18n-content]').forEach((el) => {
      el.setAttribute('content', t(el.getAttribute('data-i18n-content')));
    });
    root.querySelectorAll('[data-i18n-aria-label]').forEach((el) => {
      el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria-label')));
    });
    document.documentElement.lang = current;
    document.querySelectorAll('.lang-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-lang') === current);
    });
  }

  async function setLanguage(lang, { persist = true } = {}) {
    const next = SUPPORTED.includes(lang) ? lang : FALLBACK;
    if (next === current && persist) return;
    current = next;
    applyStaticTranslations();
    if (persist) {
      try { localStorage.setItem(STORAGE_KEY, current); } catch (e) { /* storage unavailable, ignore */ }
    }
  }

  function getLanguage() {
    return current;
  }

  async function init() {
    const [de, en] = await Promise.all([loadDictionary('de'), loadDictionary('en')]);
    dictionaries = { de, en };

    let stored = null;
    try { stored = localStorage.getItem(STORAGE_KEY); } catch (e) { /* storage unavailable, ignore */ }

    current = SUPPORTED.includes(stored) ? stored : detectBrowserLanguage();
    applyStaticTranslations();

    document.querySelectorAll('.lang-btn').forEach((btn) => {
      btn.addEventListener('click', () => setLanguage(btn.getAttribute('data-lang')));
    });
  }

  return { init, t, setLanguage, getLanguage };
})();

document.addEventListener('DOMContentLoaded', () => {
  RJSiteI18n.init();
});
