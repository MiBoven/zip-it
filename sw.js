/* Zip-It service worker — offline support (stale-while-revalidate). */
const CACHE = 'zipit-v0.4.0';
const KEEP = [CACHE, 'zipit-share'];
const ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/worker.js',
  '/manifest.json',
  '/data/common-passwords.txt',
  '/favicon.ico',
  '/icons/android-chrome-192x192.png',
  '/icons/android-chrome-512x512.png',
  '/icons/apple-touch-icon.png',
  '/icons/favicon-16x16.png',
  '/icons/favicon-32x32.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Web Share Target (Android): the OS POSTs shared files here. Stash them in a
  // cache and redirect to the app, which picks them up on load.
  if (req.method === 'POST' && url.pathname === '/share-target') {
    event.respondWith((async () => {
      try {
        const form = await req.formData();
        const files = form.getAll('files').filter((f) => f && typeof f !== 'string');
        const share = await caches.open('zipit-share');
        const meta = files.map((f, i) => ({ name: f.name || `shared-${i}`, type: f.type || '', size: f.size }));
        await share.put('/__share_meta', new Response(JSON.stringify(meta), { headers: { 'Content-Type': 'application/json' } }));
        for (let i = 0; i < files.length; i++) await share.put('/__share_' + i, new Response(files[i]));
      } catch (e) { /* fall through to the app regardless */ }
      return Response.redirect('/?share-target=1', 303);
    })());
    return;
  }

  if (req.method !== 'GET') return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req, { ignoreSearch: true });
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok && res.type === 'basic') cache.put(req, res.clone());
          return res;
        })
        .catch(() => null);
      if (cached) {
        event.waitUntil(network);
        return cached;
      }
      const res = await network;
      if (res) return res;
      if (req.mode === 'navigate') return cache.match('/index.html');
      return Response.error();
    })
  );
});
