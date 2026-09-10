// Small canvas/ImageData helpers shared by the segmentation and mesh steps.

export const MAX_WORK_SIZE = 1024

export function fileToImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Could not decode that image.'))
    }
    img.src = url
  })
}

// Downscale to a working resolution so the per-pixel passes stay interactive
// on a phone, and normalise EXIF-rotated photos through the 2D context.
export function imageToImageData(img, maxSize = MAX_WORK_SIZE) {
  const scale = Math.min(1, maxSize / Math.max(img.naturalWidth, img.naturalHeight))
  const w = Math.max(1, Math.round(img.naturalWidth * scale))
  const h = Math.max(1, Math.round(img.naturalHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(img, 0, 0, w, h)
  return ctx.getImageData(0, 0, w, h)
}

export function imageDataToCanvas(imageData) {
  const canvas = document.createElement('canvas')
  canvas.width = imageData.width
  canvas.height = imageData.height
  canvas.getContext('2d').putImageData(imageData, 0, 0)
  return canvas
}

export function cloneImageData(src) {
  return new ImageData(new Uint8ClampedArray(src.data), src.width, src.height)
}

// Applies an alpha mask to a copy of the source pixels.
export function applyMask(source, mask) {
  const out = new ImageData(new Uint8ClampedArray(source.data), source.width, source.height)
  const data = out.data
  for (let i = 0, p = 3; i < mask.length; i++, p += 4) data[p] = mask[i]
  return out
}

export function canvasToBlob(canvas, type = 'image/png', quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality))
}

// sRGB -> linear -> CIE Lab. Used for perceptual colour distance, which
// separates food from tablecloth far better than raw RGB distance.
const LAB_LUT = new Float32Array(256)
for (let i = 0; i < 256; i++) {
  const c = i / 255
  LAB_LUT[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

function pivot(t) {
  return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116
}

export function rgbToLab(r, g, b, out, offset = 0) {
  const rl = LAB_LUT[r]
  const gl = LAB_LUT[g]
  const bl = LAB_LUT[b]
  const x = pivot((rl * 0.4124 + gl * 0.3576 + bl * 0.1805) / 0.95047)
  const y = pivot(rl * 0.2126 + gl * 0.7152 + bl * 0.0722)
  const z = pivot((rl * 0.0193 + gl * 0.1192 + bl * 0.9505) / 1.08883)
  out[offset] = 116 * y - 16
  out[offset + 1] = 500 * (x - y)
  out[offset + 2] = 200 * (y - z)
  return out
}

export function toLabBuffer(imageData) {
  const { data, width, height } = imageData
  const lab = new Float32Array(width * height * 3)
  for (let i = 0, p = 0; i < width * height; i++, p += 4) {
    rgbToLab(data[p], data[p + 1], data[p + 2], lab, i * 3)
  }
  return lab
}

export function luminanceBuffer(imageData) {
  const { data, width, height } = imageData
  const out = new Float32Array(width * height)
  for (let i = 0, p = 0; i < width * height; i++, p += 4) {
    out[i] = (0.2126 * data[p] + 0.7152 * data[p + 1] + 0.0722 * data[p + 2]) / 255
  }
  return out
}

// Separable box blur, repeated to approximate a gaussian.
export function blurFloat(src, width, height, radius, passes = 2) {
  if (radius < 1) return src.slice()
  let a = src.slice()
  let b = new Float32Array(src.length)
  for (let pass = 0; pass < passes; pass++) {
    // Blur rows and write transposed, twice: the second pass is the vertical one.
    boxBlurH(a, b, width, height, radius)
    boxBlurH(b, a, height, width, radius)
  }
  return a
}

function boxBlurH(src, dst, w, h, radius) {
  const span = radius * 2 + 1
  for (let y = 0; y < h; y++) {
    const row = y * w
    let sum = 0
    for (let x = -radius; x <= radius; x++) sum += src[row + clamp(x, 0, w - 1)]
    for (let x = 0; x < w; x++) {
      dst[x * h + y] = sum / span
      sum += src[row + clamp(x + radius + 1, 0, w - 1)] - src[row + clamp(x - radius, 0, w - 1)]
    }
  }
}

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v
}

export function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}
