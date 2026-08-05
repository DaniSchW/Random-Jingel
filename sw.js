/* Service Worker for Random Jingle - caches the app shell for offline use. */
const CACHE_VERSION = 'random-jingle-v31';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/vendor/supabase.js',
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
  './impressum.html',
  './datenschutz.html',
  './agb.html',
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
      .then((cache) => cache.addAll(APP_SHELL))
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
          .catch(() => {
            if (request.mode === 'navigate') {
              return cache.match('./index.html');
            }
            return undefined;
          });
      })
    )
  );
});
