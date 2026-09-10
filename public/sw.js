/**
 * Service Worker ServiceFlow.
 *
 * Cel: aplikacja instalowalna (PWA) i sensowny komunikat offline dla pracownika
 * w terenie. Nie udajemy, że dane zapisane offline są zsynchronizowane —
 * strona offline mówi wprost, że zapis wymaga połączenia.
 */
const CACHE = 'serviceflow-shell-v1';
const SHELL = ['/offline.html', '/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).catch(() => undefined));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Nawigacje: najpierw sieć, w razie braku połączenia — strona offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(CACHE);
        const cached = await cache.match('/offline.html');
        return cached ?? new Response('Brak połączenia z internetem.', { status: 503 });
      }),
    );
    return;
  }

  // Zasoby statyczne: cache-first (ikony, czcionki, JS/CSS z poprzednich wizyt).
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          if (response.ok && response.type === 'basic') {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => undefined);
          }
          return response;
        })
        .catch(() => cached ?? Response.error());
    }),
  );
});
