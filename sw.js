const VERSION = 'hannah-debut-v1';
const SHELL_CACHE = `${VERSION}-shell`;
const MEDIA_CACHE = `${VERSION}-media`;
const APP_SHELL = [
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png'
];
const MAX_CACHED_IMAGES = 32;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(APP_SHELL.map((path) => new URL(path, self.registration.scope).href)))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith('hannah-debut-') && key !== SHELL_CACHE && key !== MEDIA_CACHE)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

async function rememberImage(request, response) {
  if (!response || !response.ok) return response;
  const cache = await caches.open(MEDIA_CACHE);
  await cache.put(request, response.clone());
  const keys = await cache.keys();
  if (keys.length > MAX_CACHED_IMAGES) {
    await Promise.all(keys.slice(0, keys.length - MAX_CACHED_IMAGES).map((key) => cache.delete(key)));
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE);
      const indexUrl = new URL('./index.html', self.registration.scope).href;
      try {
        const response = await fetch(request);
        if (response.ok) await cache.put(indexUrl, response.clone());
        return response;
      } catch {
        return (await cache.match(indexUrl)) || Response.error();
      }
    })());
    return;
  }

  if (request.destination === 'image') {
    event.respondWith((async () => {
      const cache = await caches.open(MEDIA_CACHE);
      const cached = await cache.match(request) || await caches.match(request);
      if (cached) return cached;
      try {
        return await rememberImage(request, await fetch(request));
      } catch {
        return Response.error();
      }
    })());
    return;
  }

  if (request.destination === 'style' || url.pathname.endsWith('/manifest.webmanifest')) {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE);
      try {
        const response = await fetch(request);
        if (response.ok) await cache.put(request, response.clone());
        return response;
      } catch {
        return (await cache.match(request)) || Response.error();
      }
    })());
  }
});
