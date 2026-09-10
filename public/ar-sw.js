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

  event.respondWith(serve(event.request, url))
})

async function serve(request, url) {
  try {
    const cache = await caches.open(CACHE)
    // Matched by path so a cache-busting query still hits.
    const hit = await cache.match(url.pathname, { ignoreSearch: true, ignoreVary: true })
    if (!hit) return new Response('Not found', { status: 404 })

    // Quick Look reads the archive with Range requests and gives up on a 200
    // where it asked for a 206, which shows up as the viewer opening and then
    // closing again.
    const range = request.headers.get('range')
    const body = await hit.arrayBuffer()
    if (!range) return usdzResponse(body, 200, { 'Content-Length': String(body.byteLength) })

    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
    if (!match) return usdzResponse(body, 200, { 'Content-Length': String(body.byteLength) })
    const start = match[1] ? Number(match[1]) : 0
    const end = match[2] ? Math.min(Number(match[2]), body.byteLength - 1) : body.byteLength - 1
    if (start > end || start >= body.byteLength) {
      return new Response(null, {
        status: 416,
        headers: { 'Content-Range': `bytes */${body.byteLength}` },
      })
    }
    return usdzResponse(body.slice(start, end + 1), 206, {
      'Content-Range': `bytes ${start}-${end}/${body.byteLength}`,
      'Content-Length': String(end - start + 1),
    })
  } catch {
    return new Response('Not found', { status: 404 })
  }
}

function usdzResponse(body, status, headers) {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'model/vnd.usdz+zip',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
      ...headers,
    },
  })
}
