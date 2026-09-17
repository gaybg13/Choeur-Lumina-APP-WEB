const LUMINA_SW_VERSION = "2.8.4";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // Supprime tous les anciens caches Workbox/PWA qui pouvaient servir une ancienne version.
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)));

    await self.clients.claim();

    // Force les fenêtres déjà ouvertes à recharger depuis le réseau avec le nouveau SW actif.
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    await Promise.all(windows.map(async (client) => {
      try {
        const url = new URL(client.url);
        url.searchParams.set("lumina-sw", LUMINA_SW_VERSION);
        await client.navigate(url.toString());
      } catch (_) {
        // Une fenêtre non navigable ne doit pas bloquer l'activation du SW.
      }
    }));
  })());
});

// Aucun gestionnaire fetch : les pages et données passent directement par le réseau.
// Les fichiers Vite portent un hash dans leur nom, donc leur cache HTTP immutable reste sûr.
