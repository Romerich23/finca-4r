const CACHE_NAME = 'finca3r-cache-v1';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// Instalación: guarda el "cascarón" de la app en caché
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE))
  );
  self.skipWaiting();
});

// Activación: limpia cachés viejas si se actualiza la versión
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Estrategia: red primero (para JSONBin y recursos externos), si falla usa caché
self.addEventListener('fetch', (event) => {
  // No interceptar llamadas a la API de JSONBin: siempre deben ir a la red
  if (event.request.url.includes('jsonbin.io')) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Actualiza la caché con la versión más reciente del archivo
        const responseClone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
