const CORE_CACHE_NAME = 'wifi-map-core-v2';
const TILE_CACHE_NAME = 'wifi-map-tiles-v2';

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CORE_CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('[SW] Core precache partial fail:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CORE_CACHE_NAME && key !== TILE_CACHE_NAME) {
            console.log('[SW] Clearing old cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

function isTileRequest(url) {
  return (
    url.includes('map.tkjsakti.my.id') ||
    url.includes('tile.openstreetmap.org') ||
    url.includes('arcgisonline.com') ||
    url.includes('/map.php?') ||
    url.includes('/tile/') ||
    url.match(/\/\d+\/\d+\/\d+\.(png|jpg|jpeg|webp)/i)
  );
}

function isStaticAsset(url) {
  return (
    url.includes('unpkg.com') ||
    url.includes('cdnjs.cloudflare.com') ||
    url.includes('gstatic.com/firebasejs') ||
    url.includes('/icons/') ||
    url.endsWith('.css') ||
    url.endsWith('.js')
  );
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = event.request.url;

  // 1. Map Tiles: Cache First with network fill (Stores tile map in Local Storage / Cache Storage)
  if (isTileRequest(url)) {
    event.respondWith(
      caches.open(TILE_CACHE_NAME).then(async (tileCache) => {
        const cached = await tileCache.match(event.request);
        if (cached) {
          return cached;
        }

        try {
          const networkResponse = await fetch(event.request);
          if (networkResponse && (networkResponse.status === 200 || networkResponse.type === 'opaque')) {
            tileCache.put(event.request, networkResponse.clone());
          }
          return networkResponse;
        } catch (err) {
          // If offline and not in cache, let it fail gracefully
          return cached || new Response('', { status: 504, statusText: 'Tile Offline' });
        }
      })
    );
    return;
  }

  // 2. Static CDN Libraries & Scripts: Cache First
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(event.request).then(async (cached) => {
        if (cached) return cached;
        try {
          const netRes = await fetch(event.request);
          if (netRes && (netRes.status === 200 || netRes.type === 'opaque')) {
            const cache = await caches.open(CORE_CACHE_NAME);
            cache.put(event.request, netRes.clone());
          }
          return netRes;
        } catch (err) {
          return cached;
        }
      })
    );
    return;
  }

  // 3. Navigation & Local Assets: Stale-While-Revalidate
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetchPromise = fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CORE_CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      }).catch(() => cached);

      return cached || fetchPromise;
    })
  );
});

// Listener for commands from main UI (e.g. clear tile cache)
self.addEventListener('message', (event) => {
  if (event.data && event.data.action === 'CLEAR_TILE_CACHE') {
    caches.delete(TILE_CACHE_NAME).then(() => {
      console.log('[SW] Tile cache cleared');
      if (event.ports && event.ports[0]) {
        event.ports[0].postMessage({ success: true });
      }
    });
  }
});
