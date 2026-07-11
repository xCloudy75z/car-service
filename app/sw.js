// Service worker — cache-first app shell with a build-stamped cache name.
// f4b88bea07 is replaced by scripts/build.js with a content hash so every deploy updates.
const CACHE = "car-service-f4b88bea07";
const SHELL = [
  "./", "./index.html", "./app.js", "./register-sw.js",
  "./store.js", "./select.js", "./schema.js", "./validate.js",
  "./calc.js", "./format.js", "./migrate.js",
  "./ui/render.js", "./ui/home.js", "./ui/sheet.js", "./ui/toast.js",
  "./styles/cognac.css", "./manifest.webmanifest"
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

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return; // let cross-origin (fonts) go to network
  e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)));
});
