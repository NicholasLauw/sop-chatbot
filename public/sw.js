/* Hotel SOP Assistant — service worker
   Caches the app shell so the interface opens offline.
   Note: the Gemini API and Google Drive both require a live connection,
   so answers/SOP-from-Drive won't work offline — but the app will open
   and any SOP already loaded in the current session stays usable. */

const CACHE = 'sop-assistant-v1';

// Same-origin files that make up the app shell.
const SHELL = [
  './',
  './hotel-sop-chatbot.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
];

// CDN dependency (PDF.js). Cached opaquely on first load so PDFs can be
// parsed offline afterwards.
const RUNTIME_CDN = [
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(async cache => {
      await cache.addAll(SHELL).catch(() => {});
      // Best-effort cache of CDN files (no-cors → opaque, still usable).
      await Promise.all(
        RUNTIME_CDN.map(url =>
          fetch(url, { mode: 'no-cors' })
            .then(res => cache.put(url, res))
            .catch(() => {})
        )
      );
      self.skipWaiting();
    })
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Never cache the AI or Drive API calls — always go to network.
  if (url.hostname.includes('generativelanguage.googleapis.com') ||
      url.hostname.includes('googleapis.com')) {
    return; // default browser handling
  }

  // Cache-first for the app shell + CDN; fall back to network and cache it.
  event.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req).then(res => {
        // Cache successful same-origin responses for next time.
        if (res && res.status === 200 && url.origin === self.location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => cached);
    })
  );
});
