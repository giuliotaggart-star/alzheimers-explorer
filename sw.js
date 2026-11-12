/* Offline support. Network first, so a new data file or a replaced image always wins when there is a connection;
   the cached copy is only used when the network is gone. The page also fetches every image named in the data file
   once, so a picture you swap in is ready offline without touching this file.
   Only this site's own files are ever cached: the entry form and every other outside address are left alone,
   and nothing about the visitor is held. Bump CACHE only if you rename or remove files in the list below. */
const CACHE = 'alzheimers-explorer-v2';
const FILES = [
  './',
  'index.html',
  'assets/app.css',
  'assets/app.js',
  'assets/fonts/atkinson-hyperlegible-next-latin-wght-normal.woff2',
  'assets/fonts/bricolage-grotesque-latin-wght-normal.woff2',
  'data/seaad-mtg.json',
  'assets/images/placeholder-tissue.svg',
  'assets/images/placeholder-umap.svg',
  'assets/images/placeholder-qr.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match('index.html'))));
});
