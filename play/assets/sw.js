// Brawl Street service worker — makes the game installable and playable offline.
//
// 9/21 REWRITE. The first version was cache-first for assets under one fixed cache name, on the
// assumption that new art always ships under a new filename. That was false: stage textures,
// animations, voices and music were all regenerated IN PLACE. A returning player therefore kept the
// first copy of every one of those files forever — stale art, mismatched models, "game is out of
// date" — while every fresh-profile test looked perfect, because a fresh profile has no cache.
//
// Now:
//  - the cache name comes from the build stamp in the registration URL (assets/sw.js?v=<TB_BUILD>),
//    so every deploy is a new worker that deletes every older cache on activation;
//  - EVERYTHING is network-first. The cache is only an offline fallback, never the source of truth.
//    Being correct matters far more here than shaving a load.
const VER = 'rf-' + (new URL(self.location.href).searchParams.get('v') || 'dev');

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VER) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;          // CDN three.js and fonts: leave to the browser
  e.respondWith((async () => {
    try {
      const res = await fetch(req, { cache: 'no-cache' });  // revalidate with the server every time
      if (res && res.ok && res.type === 'basic') {
        const c = await caches.open(VER);
        c.put(req, res.clone()).catch(() => {});
      }
      return res;
    } catch (err) {
      const hit = await caches.match(req);
      return hit || new Response('Offline', { status: 503, headers: { 'content-type': 'text/plain' } });
    }
  })());
});
