/* Service Worker for Random Jingle - caches the app shell for offline use. */
const CACHE_VERSION = 'random-jingle-v39';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/db.js',
  './js/audio.js',
  './js/trim.js',
  './js/mediasearch.js',
  './js/i18n.js',
  './js/consent.js',
  './js/ads.js',
  './js/sync.js',
  './js/zip.js',
  './js/export.js',
  './js/app.js',
  './i18n/de.json',
  './i18n/en.json',
  './i18n/nl.json',
  './i18n/fr.json',
  './i18n/da.json',
  './i18n/pl.json',
  './i18n/cs.json',
  './i18n/it.json',
  './impressum.html',
  './impressum.en.html',
  './datenschutz.html',
  './datenschutz.en.html',
  './agb.html',
  './agb.en.html',
  './app-icons/icon-192.png',
  './app-icons/icon-512.png',
];
// js/config.js is intentionally NOT precached: it may not exist (no
// Supabase configured) and cache.addAll() is all-or-nothing — one missing
// URL would fail the whole install. The generic fetch handler below still
// opportunistically caches it at runtime if/when it does exist.

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => Promise.all(
        // cache.addAll(urls) would fetch with the browser's default HTTP
        // cache behavior — if a file was already fetched recently (no
        // explicit Cache-Control on most static files), the browser can
        // hand back that STALE response instead of hitting the network,
        // even though CACHE_VERSION just changed specifically to pick up
        // new content. { cache: 'reload' } forces every precache fetch to
        // bypass the HTTP cache, so an update always gets the real,
        // current file instead of silently re-caching old bytes under
        // the new version name.
        APP_SHELL.map((url) => fetch(new Request(url, { cache: 'reload' }))
          .then((response) => {
            // Match cache.addAll()'s own safety behavior: fail the whole
            // install (leaving the previous, working SW in control) rather
            // than caching a broken response under a URL the app expects
            // to always resolve.
            if (!response.ok) throw new Error(`Precache fehlgeschlagen für ${url}: ${response.status}`);
            return cache.put(url, response);
          }))
      ))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  // Never cache the backend API (sync/auth/admin/audio) here. It's all
  // dynamic per-user data - caching a GET response the way the app-shell
  // logic below does would mean the FIRST pull.php/me.php/admin/stats.php
  // response gets served forever afterward, silently freezing sync, login
  // checks, and the admin dashboard. Audio downloads still benefit from
  // caching, just via the browser's own ordinary HTTP cache honoring
  // audio.php's long-lived Cache-Control header, not this layer.
  if (new URL(request.url).pathname.startsWith('/server/api/')) {
    event.respondWith(fetch(request));
    return;
  }

  // Reads (cache.match) and writes (cache.put) both go through this same,
  // explicitly-opened CACHE_VERSION cache — unlike the bare caches.match()
  // this replaces, which searches every cache under the origin regardless
  // of version and could return a stale/orphaned entry left over from a
  // cache whose activate-time cleanup never ran.
  event.respondWith(
    caches.open(CACHE_VERSION).then((cache) =>
      cache.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request)
          .then((response) => {
            if (response && response.ok && response.type === 'basic') {
              cache.put(request, response.clone());
            }
            return response;
          })
          .catch(() =>
            // respondWith() must always resolve to a real Response - ever
            // returning undefined here (as this used to for the
            // non-navigate branch, and could even for the navigate branch
            // if index.html itself weren't cached) throws "Failed to
            // convert value to 'Response'" in the page that made the
            // request, which is a much more confusing failure than a
            // plain failed fetch would have been.
            (request.mode === 'navigate' ? cache.match('./index.html') : Promise.resolve(null))
              .then((fallback) => fallback || new Response('', { status: 503, statusText: 'Offline' }))
          );
      })
    )
  );
});
