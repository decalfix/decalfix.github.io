/* Spawn Solutions service worker
   Network-first: always fresh when online, still opens when the line drops.
   API calls are never cached — stale job order data is worse than no data.
   Bump CACHE on every deploy. */
const CACHE = 'spawn-76';
/* '/' only, never '/index.html': Cloudflare answers that with a 308 to
   '/', and a worker that hands a redirected response to a page load
   fails - fine in testing, broken on a counter phone days later. */
/* The vendored library is in the SHELL for the offline case. The fetch
   handler is network-first, so an online open fetches it anyway - what this
   buys is a phone with no line still starting, which is the whole point of
   moving it off a CDN. */
const SHELL = ['/', '/manifest.json', '/icon-192.png', '/icon-512.png',
               '/vendor/supabase.js',
               '/vendor/node-buffer.js',
               '/vendor/node-process.js',
               '/vendor/node-events.js',
               '/vendor/node-tty.js',
               '/vendor/node-async_hooks.js'];

/* cache.addAll() is all-or-nothing: one 404 rejects the whole thing, install
   fails, the worker never activates, and the browser then refuses to offer
   installation forever with no visible reason. Cache each file on its own and
   let the misses go — the shell is an optimisation, not a requirement. */
self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await Promise.all(SHELL.map(u =>
      c.add(new Request(u, { cache: 'reload' })).catch(err =>
        console.warn('[sw] could not cache', u, err))));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', e => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // never touch Supabase — auth and data must always hit the network,
  // nor the Drive Worker: a cached storage figure or file list would lie
  if (url.hostname.endsWith('.supabase.co') || url.hostname.endsWith('.workers.dev')) return;

  e.respondWith((async () => {
    try {
      const res = await fetch(req);
      // a redirected response cached for a page load breaks the next start
      if (res && res.status === 200 && !res.redirected &&
          (res.type === 'basic' || res.type === 'cors')) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
      }
      return res;
    } catch (err) {
      const hit = await caches.match(req);
      if (hit) return hit;
      if (req.mode === 'navigate') {
        const shell = await caches.match('/');
        if (shell) return shell;
      }
      throw err;
    }
  })());
});
