/* ============================================================
   PS Locator — Service Worker (Offline-First PWA)
   Zero external dependencies. Static assets & Thai police data.
   NEVER caches /api/* endpoints.
   ============================================================ */
'use strict';

const CACHE_VERSION = 'v2.4.2-gtm';
const SHELL_CACHE = 'ps-locator-shell-' + CACHE_VERSION;
const DATA_CACHE = 'ps-locator-data-' + CACHE_VERSION;

const SHELL_ASSETS = [
  './',
  './index.html',
  './jurisdiction.html',
  './map.html',
  './qr-poster.html',
  './manifest.webmanifest',
  './favicon.ico',
  './assets/styles.css',
  './assets/app.js',
  './assets/map.js',
  './assets/offline-db.js',
  './assets/favicon.svg',
  './assets/favicon-48.png',
  './assets/favicon-96.png',
  './assets/icon-192.png',
  './assets/logo-512.png',
  './assets/apple-touch-icon.png',
];

const DATA_ASSETS = [
  './data/stations.js',
  './data/jurisdictions.js',
  './data/station-coords.json',
];

const NAV_FALLBACK_MAP = {
  '/': './index.html',
  '/index': './index.html',
  '/index.html': './index.html',
  '/jurisdiction': './jurisdiction.html',
  '/jurisdiction.html': './jurisdiction.html',
  '/map': './map.html',
  '/map.html': './map.html',
  '/qr-poster': './qr-poster.html',
  '/qr-poster.html': './qr-poster.html',
};

self.addEventListener('install', (event) => {
  event.waitUntil(
    Promise.all([
      caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_ASSETS)),
      caches.open(DATA_CACHE).then((cache) => cache.addAll(DATA_ASSETS)),
    ])
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((k) => k !== SHELL_CACHE && k !== DATA_CACHE)
          .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

function hasMetaChanged(oldRes, newRes) {
  if (!oldRes || !newRes) return false;
  const headers = ['etag', 'last-modified', 'content-length'];
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    const a = oldRes.headers.get(h);
    const b = newRes.headers.get(h);
    if (a && b && a !== b) return true;
  }
  return false;
}

async function notifyClients(payload) {
  try {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: false });
    for (const client of clients) {
      client.postMessage(payload);
    }
  } catch {
    /* ignore */
  }
}

async function handleNavigation(request, pathname) {
  const cleanPath = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  const fallbackKey = NAV_FALLBACK_MAP[cleanPath] || './index.html';
  try {
    const netRes = await fetch(request);
    if (netRes && netRes.ok) {
      const cache = await caches.open(SHELL_CACHE);
      cache.put(fallbackKey, netRes.clone()).catch(() => {});
    }
    return netRes;
  } catch {
    const cache = await caches.open(SHELL_CACHE);
    const exact = await cache.match(request, { ignoreSearch: true });
    if (exact) return exact;
    const mapped = await cache.match(fallbackKey);
    if (mapped) return mapped;
    const root = await cache.match('./index.html');
    return root || new Response('ไม่สามารถเชื่อมต่อเครือข่ายได้ในขณะนี้', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}

function handleStaleWhileRevalidate(event, request, cacheName, isData) {
  return caches.open(cacheName).then(async (cache) => {
    const cached = await cache.match(request, { ignoreSearch: false });
    const netPromise = fetch(request)
      .then(async (netRes) => {
        if (netRes && netRes.ok) {
          const changed = isData && hasMetaChanged(cached, netRes);
          await cache.put(request, netRes.clone());
          if (changed) {
            notifyClients({ type: 'DATA_UPDATED', url: new URL(request.url).pathname });
          }
        }
        return netRes;
      })
      .catch(() => null);

    if (cached) {
      event.waitUntil(netPromise);
      return cached;
    }
    const netRes = await netPromise;
    return netRes || new Response('', { status: 504, statusText: 'Offline' });
  });
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  /* External origins: never cache or block offline */
  if (url.origin !== self.location.origin) return;

  /* Hard rule: NEVER cache /api/*, dynamic /og, or edge SSR/SEO routes */
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname === '/og' ||
    url.pathname === '/provinces' ||
    url.pathname.startsWith('/provinces/') ||
    url.pathname.startsWith('/province/') ||
    url.pathname.startsWith('/station/') ||
    url.pathname.startsWith('/tambon/') ||
    url.pathname.startsWith('/bank/') ||
    url.pathname.startsWith('/sitemap') ||
    url.pathname === '/llms.txt'
  ) {
    return;
  }

  /* HTML navigations: Network-First with Cache Fallback */
  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request, url.pathname));
    return;
  }

  /* Same-origin data/* & assets/*: Stale-While-Revalidate */
  if (url.pathname.includes('/data/')) {
    event.respondWith(handleStaleWhileRevalidate(event, request, DATA_CACHE, true));
    return;
  }
  if (url.pathname.includes('/assets/') || url.pathname.endsWith('/manifest.webmanifest')) {
    event.respondWith(handleStaleWhileRevalidate(event, request, SHELL_CACHE, false));
  }
});
