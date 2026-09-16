const CACHE_NAME = 'sigga-cache-v3';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './logo-ganaderia4r.png'
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

// Estrategia: red primero (para Firebase y recursos externos), si falla usa caché
self.addEventListener('fetch', (event) => {
  // No interceptar llamadas a Firebase (Auth/Firestore) ni a su SDK: siempre deben ir a la red
  const url = event.request.url;
  if (url.includes('googleapis.com') || url.includes('gstatic.com') || url.includes('firebaseapp.com')) {
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
