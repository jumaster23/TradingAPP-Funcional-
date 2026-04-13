const CACHE_NAME = 'trading-bot-hibrido-v2';
const APP_SHELL = ['/', '/index.html', '/manifest.json', '/icons/icon.svg'];

async function networkFirst(request, fallbackPath = null) {
  try {
    const networkResp = await fetch(request);
    const clone = networkResp.clone();
    const cache = await caches.open(CACHE_NAME);
    cache.put(request, clone);
    return networkResp;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (fallbackPath) {
      const fallback = await caches.match(fallbackPath);
      if (fallback) return fallback;
    }
    throw new Error('Network and cache failed');
  }
}

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
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Network-first for navigations to prevent stale routes after deploy.
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, '/index.html'));
    return;
  }

  // Network-first for same-origin app assets, fallback to cache when offline.
  if (
    url.origin === self.location.origin &&
    (url.pathname.startsWith('/assets/') ||
      url.pathname.endsWith('.js') ||
      url.pathname.endsWith('.css') ||
      url.pathname.endsWith('.json') ||
      url.pathname.endsWith('.svg'))
  ) {
    event.respondWith(networkFirst(request));
  }
});
