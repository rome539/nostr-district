// Minimal service worker — required for PWA installability on Chrome/Edge.
// Intentionally NO caching: the game is fully real-time and offline play is
// not supported. We just register a fetch handler so the app is installable.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {
  // Passthrough — browser handles every request normally.
});
