// Server-side 3D reconstruction. Silhouette inflation has a hard ceiling on
// food — it can only puff up what the camera already saw — so this hands the
// cut-out to a real image-to-3D model instead and gets a mesh back.
//
// TRELLIS 2 is MIT-licensed and can be self-hosted on a 16GB NVIDIA GPU for
// nothing but electricity. It is reached here through fal because that needs
// no infrastructure; point BASE_URL at your own deployment to stop paying per
// dish.

const BASE_URL = 'https://queue.fal.run'
const KEY_STORAGE = 'ar-menu:ai-key'
const POLL_INTERVAL_MS = 1500
const TIMEOUT_MS = 8 * 60 * 1000

export const MAX_VIEWS = 4

export const ENGINES = {
  trellis2: {
    id: 'trellis2',
    endpoint: 'fal-ai/trellis-2',
    // TRELLIS 2 gained multi-view conditioning in 2026; the older dedicated
    // multi endpoint is the documented fallback if it rejects the field.
    multiEndpoint: 'fal-ai/trellis-2',
    fallbackMultiEndpoint: 'fal-ai/trellis/multi',
    label: 'TRELLIS 2',
    note: 'Microsoft TRELLIS 2, MIT licensed. Roughly $0.25–$0.35 per dish through fal.',
  },
  hunyuan3d: {
    id: 'hunyuan3d',
    endpoint: 'fal-ai/hunyuan3d/v2',
    multiEndpoint: 'fal-ai/hunyuan3d/v2/multi-view',
    label: 'Hunyuan3D v2',
    note: 'Tencent Hunyuan3D. Stronger PBR textures, community licence rather than MIT.',
  },
}

// Hunyuan's multi-view endpoint names its views rather than taking a list.
const HUNYUAN_VIEW_KEYS = ['front_image_url', 'left_image_url', 'back_image_url', 'right_image_url']

function buildRequest(config, imageUrls) {
  if (imageUrls.length < 2) {
    return { endpoint: config.endpoint, body: { image_url: imageUrls[0] } }
  }
  if (config.id === 'hunyuan3d') {
    const body = {}
    imageUrls.slice(0, HUNYUAN_VIEW_KEYS.length).forEach((url, i) => {
      body[HUNYUAN_VIEW_KEYS[i]] = url
    })
    return { endpoint: config.multiEndpoint, body }
  }
  return { endpoint: config.multiEndpoint || config.endpoint, body: { image_urls: imageUrls } }
}

export function getApiKey() {
  try {
    return localStorage.getItem(KEY_STORAGE) || ''
  } catch {
    return ''
  }
}

export function setApiKey(value) {
  try {
    if (value) localStorage.setItem(KEY_STORAGE, value)
    else localStorage.removeItem(KEY_STORAGE)
  } catch {
    // A browser refusing storage only costs the convenience of remembering it.
  }
}

// Returns the GLB as an ArrayBuffer. onProgress reports a stage name so the UI
// can say what it is waiting on: a queue can take minutes at busy times.
export async function generateMesh({ blobs, engine = 'trellis2', apiKey, onProgress, signal }) {
  const config = ENGINES[engine]
  if (!config) throw new Error(`Unknown engine: ${engine}`)
  const key = apiKey || getApiKey()
  if (!key) throw new Error('Add an API key first.')
  const views = (Array.isArray(blobs) ? blobs : [blobs]).filter(Boolean).slice(0, MAX_VIEWS)
  if (!views.length) throw new Error('No photo to reconstruct.')

  onProgress?.('upload')
  const imageUrls = await Promise.all(views.map(blobToDataUrl))

  const plan = buildRequest(config, imageUrls)
  let submit
  try {
    submit = await submitTo(plan.endpoint, plan.body, key, signal)
  } catch (cause) {
    // Providers move multi-view between endpoints; try the documented one
    // before giving up, since a rejected field is not a rejected image.
    if (imageUrls.length < 2 || !config.fallbackMultiEndpoint) throw cause
    plan.endpoint = config.fallbackMultiEndpoint
    submit = await submitTo(plan.endpoint, { image_urls: imageUrls }, key, signal)
  }

  const statusUrl = submit.status_url || `${BASE_URL}/${plan.endpoint}/requests/${submit.request_id}/status`
  const responseUrl = submit.response_url || `${BASE_URL}/${plan.endpoint}/requests/${submit.request_id}`

  const startedAt = Date.now()
  for (;;) {
    if (Date.now() - startedAt > TIMEOUT_MS) throw new Error('The 3D model took too long. Try again.')
    const status = await request(statusUrl, { key, signal })
    if (status.status === 'COMPLETED') break
    if (status.status === 'FAILED' || status.error) {
      throw new Error(describe(status.error) || 'The 3D model failed to generate.')
    }
    onProgress?.(status.status === 'IN_PROGRESS' ? 'generating' : 'queued', status.queue_position)
    await delay(POLL_INTERVAL_MS, signal)
  }

  const result = await request(responseUrl, { key, signal })
  const url = findGlbUrl(result)
  if (!url) throw new Error('The service returned no model file.')

  onProgress?.('download')
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`Could not download the model (${response.status}).`)
  return response.arrayBuffer()
}

function submitTo(endpoint, body, key, signal) {
  return request(`${BASE_URL}/${endpoint}`, { method: 'POST', key, signal, body: JSON.stringify(body) })
}

async function request(url, { method = 'GET', key, body, signal } = {}) {
  const response = await fetch(url, {
    method,
    signal,
    headers: {
      Authorization: `Key ${key}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body,
  })
  const text = await response.text()
  let payload = null
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    payload = null
  }
  if (!response.ok) {
    // Surface the service's own words: a 401 and a rejected image need
    // completely different fixes and only it knows which happened.
    throw new Error(describe(payload) || `${response.status} ${response.statusText}`)
  }
  return payload || {}
}

function describe(error) {
  if (!error) return ''
  if (typeof error === 'string') return error
  if (error.detail) {
    if (typeof error.detail === 'string') return error.detail
    if (Array.isArray(error.detail)) return error.detail.map((d) => d.msg || JSON.stringify(d)).join('; ')
  }
  return error.message || error.error || JSON.stringify(error).slice(0, 300)
}

// Providers disagree on where the file lands in the response, so look for the
// first thing that resembles a model URL rather than hardcoding one shape.
function findGlbUrl(result) {
  const seen = new Set()
  const walk = (node) => {
    if (!node || typeof node !== 'object' || seen.has(node)) return null
    seen.add(node)
    for (const value of Object.values(node)) {
      if (typeof value === 'string' && /\.(glb|gltf)(\?|$)/i.test(value)) return value
      if (typeof value === 'object') {
        const found = walk(value)
        if (found) return found
      }
    }
    return null
  }
  return walk(result)
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(new DOMException('Aborted', 'AbortError'))
      },
      { once: true },
    )
  })
}
