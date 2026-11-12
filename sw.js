/* Offline support, network first: when there is a connection the newest index.html, styles, script and data
   are always fetched, so a classroom sees an update straight away. The cached copy is used only when the
   network is gone. Only this site's own files are ever cached; forms and every other outside address are
   left alone, and nothing about the visitor is held here. Bump CACHE when files are renamed or removed. */
const CACHE = 'alzexplore-v3-5';
const FILES = [
  './',
  'index.html',
  'assets/app.css',
  'assets/app.js',
  'assets/fonts/fredoka-latin-wght-normal.woff2',
  'assets/fonts/plus-jakarta-sans-latin-wght-normal.woff2',
  'data/seaad-mtg.json',
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
    fetch(req, { cache: 'no-store' })
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match('index.html'))));
});
