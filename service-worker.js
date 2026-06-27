const CACHE_NAME = "pyrora-shell-v8";
const SHELL_ASSETS = [
  "/spinecoin.html",
  "/spinecoin.css",
  "/spinecoin.js",
  "/pyrora.webmanifest",
  "/assets/pyrora-logo.png",
  "/assets/pyrora-dino-watermark.png",
  "/assets/pyrora-icon-180.png",
  "/assets/pyrora-icon-192.png",
  "/assets/pyrora-icon-512.png"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith("/api/")) return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
        return response;
      });
    })
  );
});
