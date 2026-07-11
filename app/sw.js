// Service worker — cache-first app shell with a build-stamped cache name.
// d2675dff19 is replaced by scripts/build.js with a content hash so every deploy updates.
const CACHE = "car-service-d2675dff19";
const SHELL = [
  "./", "./index.html", "./app.js", "./register-sw.js", "./build-info.js",
  "./store.js", "./select.js", "./schema.js", "./validate.js",
  "./calc.js", "./format.js", "./migrate.js",
  "./ui/render.js", "./ui/home.js", "./ui/sheet.js", "./ui/toast.js",
  "./ui/maintenance.js", "./ui/insights.js",
  "./styles/cognac.css", "./manifest.webmanifest",
  "./fonts/inter.woff2", "./fonts/jetbrains-mono.woff2", "./fonts/bricolage-grotesque.woff2"
];

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Let the page force an immediately-waiting worker to take over (manual "Check for updates").
self.addEventListener("message", (e) => { if (e.data === "skipWaiting") self.skipWaiting(); });

// Cache-first for same-origin GETs, with runtime caching so any asset (incl. fonts and
// modules added in later builds) is available offline after its first fetch.
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(
    caches.match(e.request).then((cached) => {
      if (cached) return cached;
      return fetch(e.request)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
          }
          return res;
        })
        .catch(() => cached);
    })
  );
});
