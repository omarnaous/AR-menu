// Background removal that runs entirely in the browser: no API keys, no upload,
// no per-image cost. It models the plate/table colours from the border ring and
// the dish colours from the middle, then labels every pixel by which model it is
// closer to in Lab space. Good enough for the way restaurants actually shoot
// food (dish centred, fairly plain surface), and tunable when it is not.

import { toLabBuffer, clamp } from './imaging.js'

const KMEANS_K = 5
const KMEANS_ITERATIONS = 8

export const DEFAULT_SEGMENT_OPTIONS = {
  tolerance: 0.5, // 0 keeps more of the photo, 1 cuts more away
  shrink: 1, // erode this many pixels to kill the background halo
  feather: 1.5, // soft edge in pixels
  rect: null, // { x, y, w, h } in 0..1 — anything outside is background
}

export function segmentFood(imageData, options = {}) {
  const opts = { ...DEFAULT_SEGMENT_OPTIONS, ...options }
  const { width, height } = imageData
  const count = width * height
  const lab = toLabBuffer(imageData)

  const bounds = normaliseRect(opts.rect, width, height)
  const bg = kmeans(sampleBorder(lab, width, height, bounds), KMEANS_K)
  const fg = kmeans(sampleInterior(lab, width, height, bounds), KMEANS_K)

  const score = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    const o = i * 3
    const l = lab[o]
    const a = lab[o + 1]
    const b = lab[o + 2]
    const dBg = Math.sqrt(nearestDistanceSq(bg, l, a, b))
    const dFg = Math.sqrt(nearestDistanceSq(fg, l, a, b))
    score[i] = dBg / (dBg + dFg + 1e-6)
  }

  // tolerance 0.5 -> cut at the midpoint between the two models.
  const threshold = 0.28 + clamp(opts.tolerance, 0, 1) * 0.44
  let mask = new Uint8Array(count)
  for (let i = 0; i < count; i++) mask[i] = score[i] > threshold ? 1 : 0

  if (bounds) clearOutsideRect(mask, width, height, bounds)

  mask = erode(mask, width, height, 1)
  mask = dilate(mask, width, height, 1)
  mask = keepMainComponents(mask, width, height, bounds)
  fillHoles(mask, width, height)

  if (opts.shrink > 0) mask = erode(mask, width, height, Math.round(opts.shrink))

  return featherToAlpha(mask, width, height, opts.feather)
}

// Paints or erases the mask under a circular brush; lets a user fix the one
// corner the automatic pass got wrong instead of re-shooting the photo.
export function paintAlpha(alpha, width, height, x, y, radius, value) {
  const x0 = Math.max(0, Math.floor(x - radius))
  const x1 = Math.min(width - 1, Math.ceil(x + radius))
  const y0 = Math.max(0, Math.floor(y - radius))
  const y1 = Math.min(height - 1, Math.ceil(y + radius))
  const r2 = radius * radius
  for (let py = y0; py <= y1; py++) {
    for (let px = x0; px <= x1; px++) {
      const dx = px - x
      const dy = py - y
      const d2 = dx * dx + dy * dy
      if (d2 > r2) continue
      const falloff = 1 - Math.sqrt(d2) / radius
      const strength = Math.min(1, falloff * 2)
      const i = py * width + px
      const target = value ? 255 : 0
      alpha[i] = Math.round(alpha[i] + (target - alpha[i]) * strength)
    }
  }
  return alpha
}

export function alphaCoverage(alpha) {
  let sum = 0
  for (let i = 0; i < alpha.length; i++) sum += alpha[i]
  return sum / (alpha.length * 255)
}

function normaliseRect(rect, width, height) {
  if (!rect) return null
  const x0 = clamp(Math.round(rect.x * width), 0, width - 1)
  const y0 = clamp(Math.round(rect.y * height), 0, height - 1)
  const x1 = clamp(Math.round((rect.x + rect.w) * width), x0 + 1, width)
  const y1 = clamp(Math.round((rect.y + rect.h) * height), y0 + 1, height)
  return { x0, y0, x1, y1 }
}

function sampleBorder(lab, width, height, bounds) {
  const samples = []
  const ring = Math.max(4, Math.round(Math.min(width, height) * 0.04))
  const step = Math.max(1, Math.round(Math.min(width, height) / 220))
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const outsideRect = bounds && (x < bounds.x0 || x >= bounds.x1 || y < bounds.y0 || y >= bounds.y1)
      const onRing = x < ring || y < ring || x >= width - ring || y >= height - ring
      if (!outsideRect && !onRing) continue
      const o = (y * width + x) * 3
      samples.push(lab[o], lab[o + 1], lab[o + 2])
    }
  }
  return new Float32Array(samples)
}

function sampleInterior(lab, width, height, bounds) {
  const b = bounds || { x0: 0, y0: 0, x1: width, y1: height }
  const cx = (b.x0 + b.x1) / 2
  const cy = (b.y0 + b.y1) / 2
  const rx = (b.x1 - b.x0) * 0.3
  const ry = (b.y1 - b.y0) * 0.3
  const samples = []
  const step = Math.max(1, Math.round(Math.min(width, height) / 220))
  for (let y = Math.round(cy - ry); y < cy + ry; y += step) {
    for (let x = Math.round(cx - rx); x < cx + rx; x += step) {
      if (x < 0 || y < 0 || x >= width || y >= height) continue
      const o = (y * width + x) * 3
      samples.push(lab[o], lab[o + 1], lab[o + 2])
    }
  }
  return new Float32Array(samples)
}

function kmeans(samples, k) {
  const n = samples.length / 3
  if (n === 0) return new Float32Array([50, 0, 0])
  const centroids = new Float32Array(k * 3)
  for (let c = 0; c < k; c++) {
    const idx = Math.floor((c + 0.5) * (n / k)) * 3
    centroids[c * 3] = samples[idx]
    centroids[c * 3 + 1] = samples[idx + 1]
    centroids[c * 3 + 2] = samples[idx + 2]
  }
  const sums = new Float32Array(k * 3)
  const counts = new Uint32Array(k)
  for (let iter = 0; iter < KMEANS_ITERATIONS; iter++) {
    sums.fill(0)
    counts.fill(0)
    for (let i = 0; i < n; i++) {
      const o = i * 3
      let best = 0
      let bestD = Infinity
      for (let c = 0; c < k; c++) {
        const p = c * 3
        const dl = samples[o] - centroids[p]
        const da = samples[o + 1] - centroids[p + 1]
        const db = samples[o + 2] - centroids[p + 2]
        const d = dl * dl + da * da + db * db
        if (d < bestD) {
          bestD = d
          best = c
        }
      }
      counts[best]++
      sums[best * 3] += samples[o]
      sums[best * 3 + 1] += samples[o + 1]
      sums[best * 3 + 2] += samples[o + 2]
    }
    for (let c = 0; c < k; c++) {
      if (!counts[c]) continue
      centroids[c * 3] = sums[c * 3] / counts[c]
      centroids[c * 3 + 1] = sums[c * 3 + 1] / counts[c]
      centroids[c * 3 + 2] = sums[c * 3 + 2] / counts[c]
    }
  }
  return centroids
}

function nearestDistanceSq(centroids, l, a, b) {
  let best = Infinity
  for (let p = 0; p < centroids.length; p += 3) {
    const dl = l - centroids[p]
    const da = a - centroids[p + 1]
    const db = b - centroids[p + 2]
    const d = dl * dl + da * da + db * db
    if (d < best) best = d
  }
  return best
}

function clearOutsideRect(mask, width, height, b) {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x < b.x0 || x >= b.x1 || y < b.y0 || y >= b.y1) mask[y * width + x] = 0
    }
  }
}

function erode(mask, width, height, radius) {
  let src = mask
  for (let r = 0; r < radius; r++) src = morph(src, width, height, 0)
  return src
}

function dilate(mask, width, height, radius) {
  let src = mask
  for (let r = 0; r < radius; r++) src = morph(src, width, height, 1)
  return src
}

// One 4-connected morphological step. target 0 = erode, 1 = dilate.
function morph(mask, width, height, target) {
  const out = new Uint8Array(mask)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (mask[i] === target) continue
      const up = y > 0 ? mask[i - width] : target
      const down = y < height - 1 ? mask[i + width] : target
      const left = x > 0 ? mask[i - 1] : target
      const right = x < width - 1 ? mask[i + 1] : target
      if (up === target || down === target || left === target || right === target) out[i] = target
    }
  }
  return out
}

// Labels connected blobs and keeps the big ones. A plate of fries is several
// blobs, so anything above a fraction of the largest survives.
function keepMainComponents(mask, width, height, bounds) {
  const labels = new Int32Array(mask.length).fill(-1)
  const stack = new Int32Array(mask.length)
  const areas = []
  let next = 0
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || labels[start] !== -1) continue
    let sp = 0
    stack[sp++] = start
    labels[start] = next
    let area = 0
    while (sp > 0) {
      const i = stack[--sp]
      area++
      const x = i % width
      const y = (i / width) | 0
      if (x > 0 && mask[i - 1] && labels[i - 1] === -1) { labels[i - 1] = next; stack[sp++] = i - 1 }
      if (x < width - 1 && mask[i + 1] && labels[i + 1] === -1) { labels[i + 1] = next; stack[sp++] = i + 1 }
      if (y > 0 && mask[i - width] && labels[i - width] === -1) { labels[i - width] = next; stack[sp++] = i - width }
      if (y < height - 1 && mask[i + width] && labels[i + width] === -1) { labels[i + width] = next; stack[sp++] = i + width }
    }
    areas.push(area)
    next++
  }
  if (!areas.length) return mask
  const largest = Math.max(...areas)
  const minArea = Math.max(largest * 0.05, mask.length * 0.0008)
  const out = new Uint8Array(mask.length)
  for (let i = 0; i < mask.length; i++) {
    const label = labels[i]
    if (label >= 0 && areas[label] >= minArea) out[i] = 1
  }
  return out
}

// Anything enclosed by the dish (a gap between two shrimp) belongs to the dish.
function fillHoles(mask, width, height) {
  const visited = new Uint8Array(mask.length)
  const stack = new Int32Array(mask.length)
  let sp = 0
  const push = (i) => {
    if (!visited[i] && !mask[i]) {
      visited[i] = 1
      stack[sp++] = i
    }
  }
  for (let x = 0; x < width; x++) {
    push(x)
    push((height - 1) * width + x)
  }
  for (let y = 0; y < height; y++) {
    push(y * width)
    push(y * width + width - 1)
  }
  while (sp > 0) {
    const i = stack[--sp]
    const x = i % width
    const y = (i / width) | 0
    if (x > 0) push(i - 1)
    if (x < width - 1) push(i + 1)
    if (y > 0) push(i - width)
    if (y < height - 1) push(i + width)
  }
  for (let i = 0; i < mask.length; i++) if (!mask[i] && !visited[i]) mask[i] = 1
}

function featherToAlpha(mask, width, height, feather) {
  const alpha = new Uint8Array(mask.length)
  for (let i = 0; i < mask.length; i++) alpha[i] = mask[i] ? 255 : 0
  const radius = Math.round(feather)
  if (radius < 1) return alpha
  const float = new Float32Array(mask.length)
  for (let i = 0; i < mask.length; i++) float[i] = mask[i]
  const blurred = boxBlur(float, width, height, radius)
  for (let i = 0; i < mask.length; i++) alpha[i] = Math.round(clamp(blurred[i], 0, 1) * 255)
  return alpha
}

function boxBlur(src, width, height, radius) {
  const tmp = new Float32Array(src.length)
  const out = new Float32Array(src.length)
  const span = radius * 2 + 1
  for (let y = 0; y < height; y++) {
    let sum = 0
    for (let x = -radius; x <= radius; x++) sum += src[y * width + clamp(x, 0, width - 1)]
    for (let x = 0; x < width; x++) {
      tmp[y * width + x] = sum / span
      sum += src[y * width + clamp(x + radius + 1, 0, width - 1)] - src[y * width + clamp(x - radius, 0, width - 1)]
    }
  }
  for (let x = 0; x < width; x++) {
    let sum = 0
    for (let y = -radius; y <= radius; y++) sum += tmp[clamp(y, 0, height - 1) * width + x]
    for (let y = 0; y < height; y++) {
      out[y * width + x] = sum / span
      sum += tmp[clamp(y + radius + 1, 0, height - 1) * width + x] - tmp[clamp(y - radius, 0, height - 1) * width + x]
    }
  }
  return out
}

// Guesses the camera angle from the cut-out so the studio does not have to ask.
// A round plate photographed from above is a circle; the same plate at
// three-quarters is an ellipse roughly 0.6 as tall as it is wide. Second
// moments of the mask give that ratio without assuming the dish is centred.
export function estimateTilt(alpha, width, height) {
  let m00 = 0
  let m10 = 0
  let m01 = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const w = alpha[y * width + x] / 255
      if (w < 0.5) continue
      m00 += w
      m10 += w * x
      m01 += w * y
    }
  }
  if (m00 < 32) return 90
  const cx = m10 / m00
  const cy = m01 / m00

  let xx = 0
  let yy = 0
  let xy = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const w = alpha[y * width + x] / 255
      if (w < 0.5) continue
      const dx = x - cx
      const dy = y - cy
      xx += w * dx * dx
      yy += w * dy * dy
      xy += w * dx * dy
    }
  }
  xx /= m00
  yy /= m00
  xy /= m00

  // Eigenvalues of the covariance matrix are the squared semi-axes.
  const mean = (xx + yy) / 2
  const diff = Math.sqrt(Math.max(0, ((xx - yy) / 2) ** 2 + xy * xy))
  const major = Math.sqrt(Math.max(mean + diff, 1e-6))
  const minor = Math.sqrt(Math.max(mean - diff, 1e-6))
  const ratio = minor / major

  // A near-circle was shot from above; anything squashed was shot at an angle.
  return ratio > 0.82 ? 90 : 45
}
