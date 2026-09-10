// Serves generated USDZ files from the Cache API at a real same-origin URL.
//
// AR Quick Look on iOS is fussy: it wants an https URL that ends in .usdz and
// answers with model/vnd.usdz+zip. A blob: URL satisfies neither, and the SPA
// fallback would hand /ar/<id>.usdz the index page. This worker is the whole
// fix, and it means the conversion still needs no backend.

const CACHE = 'ar-usdz'

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (url.origin !== self.location.origin) return
  if (!url.pathname.endsWith('.usdz')) return

  event.respondWith(
    caches
      .open(CACHE)
      // Matched by path so a Range header or a cache-busting query still hits.
      .then((cache) => cache.match(url.pathname, { ignoreSearch: true, ignoreVary: true }))
      .then((hit) => hit || new Response('Not found', { status: 404 }))
      .catch(() => new Response('Not found', { status: 404 })),
  )
})
