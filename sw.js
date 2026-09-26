const CACHE_NAME = 'artefactos-robados-v4';
const APP_SHELL = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// Instala y cachea el shell de la app (HTML/CSS/JS propios).
// Los datos (Google Sheets) y los tiles de mapa NO se cachean acá:
// son externos y tienen que leerse en vivo.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const isOwnOrigin = url.origin === self.location.origin;

  if (!isOwnOrigin) return; // tiles de OSM y la hoja de Google pasan directo, sin cache

  // Network-first: mientras haya conexión, siempre se usa la versión más
  // nueva del archivo (evita quedarse pegado con un app.js viejo mientras
  // se está iterando). El cache solo se usa si falla la red (offline).
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
