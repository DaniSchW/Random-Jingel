/* Google AdSense loader for Random Jingle.
 * The AdSense script is injected dynamically, and only once ad-cookie
 * consent has been explicitly granted (RJConsent.getStatus() === 'granted')
 * -- never speculatively, and never as a static <script> tag in index.html.
 * If consent is later revoked there is no way to "unload" an already-loaded
 * script (browsers don't support that) -- app.js instead just hides the ad
 * slot again, which is what actually matters privacy-wise (no ad shown, no
 * further requests triggered by us).
 *
 * Ad failures must never take the rest of the app down with them (e.g. on
 * localhost, or any domain not yet approved in the AdSense account, the
 * script can fail to load or fail while trying to fill the slot). Every
 * entry point here is self-contained: load()/requestAd() catch their own
 * synchronous errors, and a capture-phase window 'error' listener catches
 * asynchronous errors thrown from *inside* the already-loaded AdSense
 * script (outside our own call stack, so a plain try/catch around our call
 * site wouldn't see them) and downgrades them to a console.warn instead of
 * letting them surface as an uncaught page error.
 */
const RJAds = (() => {
  const ADSENSE_SRC = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-8453553622026562';
  const ADSENSE_HOST = 'googlesyndication.com';

  let loaded = false;
  let loadPromise = null;

  function isLoaded() {
    return loaded;
  }

  function load() {
    if (loadPromise) return loadPromise;
    loadPromise = new Promise((resolve, reject) => {
      try {
        const script = document.createElement('script');
        script.async = true;
        script.src = ADSENSE_SRC;
        script.crossOrigin = 'anonymous';
        script.onload = () => {
          loaded = true;
          resolve();
        };
        script.onerror = (err) => {
          loadPromise = null;
          reject(err);
        };
        document.head.appendChild(script);
      } catch (err) {
        loadPromise = null;
        reject(err);
      }
    });
    return loadPromise;
  }

  // Tells AdSense to scan the page and fill any <ins class="adsbygoogle">
  // element that doesn't have an ad in it yet. Each element may only be
  // requested once -- calling this again for an already-filled one throws,
  // which is why this is wrapped rather than left to the caller alone.
  function requestAd() {
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch (err) {
      console.warn('AdSense: Anzeige konnte nicht angefordert werden', err);
    }
  }

  // Errors thrown asynchronously from inside the AdSense script itself
  // (e.g. while it tries to fill a slot on a domain that isn't approved
  // yet) happen outside any try/catch of ours. Intercept them here so they
  // never reach the console as an uncaught error or interrupt anything
  // else on the page -- the ad slot just stays empty either way.
  window.addEventListener('error', (event) => {
    if (event.filename && event.filename.includes(ADSENSE_HOST)) {
      console.warn('AdSense-Skriptfehler (ignoriert, Werbefläche bleibt leer)', event.error || event.message);
      event.preventDefault();
    }
  }, true);

  return { load, isLoaded, requestAd };
})();
