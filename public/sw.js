// RentReadies service worker: lets the installed app open with no signal.
// Inspection data lives in IndexedDB on the phone; this only caches the app itself.
const CACHE = "rr-shell-v1";
const SHELL = ["/", "/manifest.webmanifest", "/icon.svg", "/icon-192.png", "/apple-touch-icon.png"];

// Cache the shell plus the hashed JS/CSS that index.html points at, so the app can start offline.
self.addEventListener("install", (e) => {
  e.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(SHELL);
      const html = await (await cache.match("/")).text();
      const assets = [...new Set(html.match(/\/assets\/[^"']+/g) ?? [])];
      await cache.addAll(assets);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  // Pages: network first so updates show up, cached copy when offline.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put("/", copy));
          return res;
        })
        .catch(() => caches.match("/")),
    );
    return;
  }

  // Built assets have content hashes in their names, so cache-first is safe.
  e.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok && (url.pathname.startsWith("/assets/") || SHELL.includes(url.pathname))) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
