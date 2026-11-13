/* Offline support, network first: when there is a connection the newest index.html, styles, script and data
   are always fetched, so a classroom sees an update straight away. The cached copy is used only when the
   network is gone. Only this site's own files are ever cached; forms and every other outside address are
   left alone, and nothing about the visitor is held here. Bump CACHE when files are renamed or removed.
   The data film is never cached (it is large and streamed in ranges); only its poster is, and only if it exists. */
const CACHE = 'unravel-v5';
const FILES = [
  './',
  'index.html',
  'assets/app.css',
  'assets/app.js',
  'assets/fonts/bagel-fat-one-latin-400-normal.woff2',
  'assets/fonts/plus-jakarta-sans-latin-wght-normal.woff2',
  'assets/fonts/dm-mono-latin-400-normal.woff2',
  'data/seaad-mtg.json',
];
const OPTIONAL = ['assets/video/data-journey.jpg'];
const isVideo = (url) => /\.(mp4|webm|mov)$/i.test(new URL(url).pathname);

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE)
    .then((cache) => cache.addAll(FILES).then(() => Promise.all(OPTIONAL.map((f) => cache.add(f).catch(() => {})))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin || isVideo(req.url) || req.headers.has('range')) return;
  event.respondWith(
    fetch(req, { cache: 'no-store' })
      .then((res) => {
        if (res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match('index.html'))));
});
