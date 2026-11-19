// JagaLog Custom Service Worker v1.0.0
// Strategi Caching AMAN: Zero Sensitive Data Caching

const CACHE_NAME = "jagalog-static-v1";
const OFFLINE_URL = "/offline";

const PRECACHE_ASSETS = [
  OFFLINE_URL,
  "/manifest.webmanifest",
  "/favicon.ico",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
];

// Install: Pre-cache aset statis offline minimum
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_ASSETS))
      .catch((err) => console.warn("[SW] Gagal precache aset:", err))
  );
});

// Activate: Bersihkan cache versi lama
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.map((key) => {
            if (key !== CACHE_NAME) {
              return caches.delete(key);
            }
          })
        )
      )
      .then(() => self.clients.claim())
  );
});

// Fetch: Caching aman & terkendali
self.addEventListener("fetch", (event) => {
  const req = event.request;

  // 1. Abaikan permintaan non-GET
  if (req.method !== "GET") {
    return;
  }

  const url = new URL(req.url);

  // 2. BYPASS MUTLAK: SSE (/api/stream), Ingest (/api/ingest), dan Peta Topologi (/peta) TIDAK BOLEH di-cache
  if (
    url.pathname === "/api/stream" ||
    url.pathname === "/api/ingest" ||
    url.pathname === "/peta" ||
    url.pathname.startsWith("/peta/")
  ) {
    return;
  }

  // 3. Seluruh endpoint API (/api/*): STRICT NETWORK-ONLY (JANGAN pernah di-cache)
  if (url.pathname.startsWith("/api/")) {
    return;
  }

  // 4. Aset Statis Terversi Next.js, Font, dan Ikon: CACHE-FIRST
  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/favicon.ico" ||
    url.pathname === "/manifest.webmanifest" ||
    url.pathname === "/manifest.json" ||
    url.hostname === "fonts.googleapis.com" ||
    url.hostname === "fonts.gstatic.com"
  ) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) {
          return cached;
        }
        return fetch(req)
          .then((response) => {
            if (!response || response.status !== 200) {
              return response;
            }
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
            return response;
          })
          .catch(() => cached);
      })
    );
    return;
  }

  // 5. Navigasi Halaman HTML: NETWORK-ONLY dengan Fallback Offline
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() => {
        return caches.match(OFFLINE_URL).then((offlineRes) => {
          if (offlineRes) return offlineRes;
          return new Response(
            "<html><body><h1>Offline</h1><p>Tidak ada koneksi internet.</p></body></html>",
            {
              headers: { "Content-Type": "text/html; charset=utf-8" },
            }
          );
        });
      })
    );
    return;
  }
});

// Message listener untuk update versi dan logout
self.addEventListener("message", (event) => {
  if (!event.data) return;

  if (event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }

  // Saat logout: bersihkan seluruh Cache Storage
  if (event.data.type === "CLEAR_CACHE") {
    caches.keys().then((keys) => {
      keys.forEach((key) => caches.delete(key));
    });
  }
});
