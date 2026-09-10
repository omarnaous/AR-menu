// Delivery side of iOS AR: put the exported USDZ somewhere Quick Look accepts.
// See public/ar-sw.js for why a blob: URL is not good enough.

const CACHE = 'ar-usdz'
const BASE = import.meta.env.BASE_URL || '/'

let readyPromise = null

export function initArDelivery() {
  if (readyPromise) return readyPromise
  const supported =
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof caches !== 'undefined' &&
    window.isSecureContext
  if (!supported) {
    readyPromise = Promise.resolve(false)
    return readyPromise
  }
  readyPromise = navigator.serviceWorker
    .register(`${BASE}ar-sw.js`, { scope: BASE })
    .then(() => navigator.serviceWorker.ready)
    .then(() => (navigator.serviceWorker.controller ? true : waitForController()))
    .catch(() => false)
  return readyPromise
}

// On the very first visit the worker activates after the page loaded, so it is
// not controlling this client yet. clients.claim() fixes that a beat later.
function waitForController() {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 4000)
    navigator.serviceWorker.addEventListener(
      'controllerchange',
      () => {
        clearTimeout(timer)
        resolve(true)
      },
      { once: true },
    )
  })
}

export function usdzPath(id) {
  return `${BASE}ar/${id}.usdz`
}

// Returns a URL Quick Look can open, or null when the worker is unavailable
// (plain http, or a browser without service workers).
export async function publishUsdz(id, blob) {
  if (!blob) return null
  if (!(await initArDelivery())) return null
  const path = usdzPath(id)
  const cache = await caches.open(CACHE)
  await cache.put(
    path,
    new Response(blob, {
      headers: {
        'Content-Type': 'model/vnd.usdz+zip',
        'Content-Length': String(blob.size),
        'Cache-Control': 'no-store',
      },
    }),
  )
  return path
}

export async function unpublishUsdz(id) {
  if (typeof caches === 'undefined') return
  try {
    const cache = await caches.open(CACHE)
    await cache.delete(usdzPath(id), { ignoreSearch: true })
  } catch {
    // A missing cache is not worth reporting.
  }
}
