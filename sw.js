const CACHE_VERSION = 'fitness-tracker-v14';

const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './css/base.css',
  './css/layout.css',
  './css/components.css',
  './js/lib/dexie.min.js',
  './js/lib/chart.umd.min.js',
  './js/app.js',
  './js/core/store.js',
  './js/core/ui.js',
  './js/core/format.js',
  './js/core/escape.js',
  './js/core/progression.js',
  './js/core/stats.js',
  './js/core/skinfold-points.js',
  './js/core/settings.js',
  './js/core/units.js',
  './js/core/ai-import.js',
  './js/core/exercise-match.js',
  './js/db/schema.js',
  './js/db/repository.js',
  './js/views/home.js',
  './js/views/exercise-library.js',
  './js/views/exercise-detail.js',
  './js/views/workout-new.js',
  './js/views/workout-import.js',
  './js/views/workout-session.js',
  './js/views/workout-history.js',
  './js/views/workout-calendar.js',
  './js/views/templates.js',
  './js/views/progress-hub.js',
  './js/views/bodyweight.js',
  './js/views/measurements.js',
  './js/views/skinfold.js',
  './js/views/ai-analysis.js',
  './js/views/settings-backup.js',
  './js/views/settings-hub.js',
  './js/views/onboarding.js',
  './icons/icon-32.png',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/muscles/icon-pierna.png',
  './icons/muscles/icon-culo.png',
  './icons/muscles/icon-espalda.png',
  './icons/muscles/icon-abs.png',
  './icons/muscles/icon-pecho.png',
  './icons/muscles/icon-hombro.png',
  './icons/muscles/icon-brazo.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      Promise.all(
        PRECACHE_URLS.map((url) =>
          // cache: 'reload' fuerza ir a red e ignora la caché HTTP del
          // navegador — con fetch normal, un asset ya cacheado por el
          // navegador (Cache-Control de GitHub Pages) podía precachearse
          // "de nuevo" pero con bytes antiguos.
          fetch(new Request(url, { cache: 'reload' }))
            .then((response) => cache.put(url, response))
            .catch((err) => console.warn('No se pudo precachear', url, err))
        )
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;

      return fetch(event.request)
        .then((response) => {
          if (response.ok && response.type === 'basic') {
            const copy = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => caches.match('./index.html'));
    })
  );
});
