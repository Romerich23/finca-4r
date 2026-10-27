// SIGGA - Service Worker (modo sin conexión)
// - Archivos propios de la app: "red primero" (siempre la versión más nueva si hay Internet,
//   y si no hay o tarda demasiado, usa la copia guardada en el dispositivo).
// - Librerías externas (Bootstrap, Chart.js, iconos, fuentes y Firebase SDK): se guardan al instalar
//   y se sirven desde el dispositivo (se actualizan en segundo plano).
// - Llamadas a Firestore / Auth (datos y sesión): NO se interceptan; de eso se encarga Firebase
//   con su propia caché local.
const CACHE_NAME = 'sigga-cache-v4';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './logo-ganaderia4r.png'
];

const FIREBASE_BASE = 'https://www.gstatic.com/firebasejs/10.13.0/';
const EXTERNAL_ASSETS = [
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css',
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js',
  'https://cdn.jsdelivr.net/npm/chart.js',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&family=Open+Sans:wght@300;400;600&display=swap',
  FIREBASE_BASE + 'firebase-app.js',
  FIREBASE_BASE + 'firebase-auth.js',
  FIREBASE_BASE + 'firebase-firestore.js'
];

// Hosts de librerías estáticas que sí se guardan en caché
const STATIC_HOSTS = [
  'cdn.jsdelivr.net',
  'cdnjs.cloudflare.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'www.gstatic.com'
];

const NETWORK_TIMEOUT_MS = 4000;

function isStaticExternal(url) {
  if (!STATIC_HOSTS.includes(url.hostname)) return false;
  // En www.gstatic.com solo el SDK de Firebase (nada más)
  if (url.hostname === 'www.gstatic.com') return url.pathname.startsWith('/firebasejs/');
  return true;
}

// fetch que se rinde si el servidor no responde a tiempo (señal muy débil)
function fetchWithTimeout(request, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(request, { signal: controller.signal }).then(
    (res) => { clearTimeout(timer); return res; },
    (err) => { clearTimeout(timer); throw err; }
  );
}

// Guarda un recurso externo; si es una hoja de estilos, guarda también sus fuentes (.woff2)
async function cacheExternal(cache, url) {
  let res;
  try {
    res = await fetch(url, { mode: 'cors', credentials: 'omit' });
  } catch (e) {
    res = await fetch(url, { mode: 'no-cors', credentials: 'omit' });
  }
  if (!res || !(res.ok || res.type === 'opaque')) throw new Error('No se pudo guardar ' + url);
  await cache.put(url, res.clone());

  if (res.type !== 'opaque' && (url.endsWith('.css') || url.includes('fonts.googleapis.com/css'))) {
    const css = await res.text();
    const fontUrls = new Set();
    const re = /url\(\s*['"]?([^'")]+?)['"]?\s*\)/g;
    let m;
    while ((m = re.exec(css)) !== null) {
      if (/\.woff2(\?|#|$)/.test(m[1])) fontUrls.add(new URL(m[1], url).href);
    }
    await Promise.allSettled([...fontUrls].map(async (fontUrl) => {
      const fontRes = await fetch(fontUrl, { mode: 'cors', credentials: 'omit' });
      if (fontRes.ok) await cache.put(fontUrl, fontRes);
    }));
  }
}

// Instalación: guarda la app y sus librerías para poder abrirla sin Internet
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL);
    // Si alguna librería externa falla, no se cancela la instalación; se guardará al usarla.
    await Promise.allSettled(EXTERNAL_ASSETS.map((u) => cacheExternal(cache, u)));
  })());
  self.skipWaiting();
});

// Activación: limpia cachés de versiones anteriores
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

// Archivos propios: red primero (con tiempo máximo) y, si falla, la copia guardada
async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetchWithTimeout(request, NETWORK_TIMEOUT_MS);
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(request, { ignoreSearch: true })
      || (request.mode === 'navigate' ? await cache.match('./index.html') : undefined);
    if (cached) return cached;
    throw err;
  }
}

// Librerías externas: sirve la copia guardada y la actualiza en segundo plano
async function staleWhileRevalidate(event) {
  const request = event.request;
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request, { ignoreVary: true });
  const refresh = fetch(request)
    .then((response) => {
      if (response && (response.ok || response.type === 'opaque')) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  if (cached) {
    event.waitUntil(refresh);
    return cached;
  }
  const response = await refresh;
  return response || Response.error();
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(request));
    return;
  }
  if (isStaticExternal(url)) {
    event.respondWith(staleWhileRevalidate(event));
    return;
  }
  // Todo lo demás (Firestore, Auth, etc.) va directo a la red, sin interceptar
});
