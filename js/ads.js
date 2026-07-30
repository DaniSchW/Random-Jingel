/* Google AdSense loader for Random Jingle.
 * The AdSense script is injected dynamically, and only once ad-cookie
 * consent has been explicitly granted (RJConsent.getStatus() === 'granted')
 * -- never speculatively, and never as a static <script> tag in index.html.
 * If consent is later revoked there is no way to "unload" an already-loaded
 * script (browsers don't support that) -- app.js instead just hides the ad
 * slot again, which is what actually matters privacy-wise (no ad shown, no
 * further requests triggered by us).
 */
const RJAds = (() => {
  const ADSENSE_SRC = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-8453553622026562';

  let loaded = false;
  let loadPromise = null;

  function isLoaded() {
    return loaded;
  }

  function load() {
    if (loadPromise) return loadPromise;
    loadPromise = new Promise((resolve, reject) => {
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
    });
    return loadPromise;
  }

  // Tells AdSense to scan the page and fill any <ins class="adsbygoogle">
  // element that doesn't have an ad in it yet. Each element may only be
  // requested once -- calling this again for an already-filled one throws.
  function requestAd() {
    (window.adsbygoogle = window.adsbygoogle || []).push({});
  }

  return { load, isLoaded, requestAd };
})();
