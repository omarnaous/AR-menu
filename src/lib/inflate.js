// Turns a flat cut-out photo into a 3D dish.
//
// A single photo has no depth information, so nothing free (or paid) can
// recover the true geometry of a plate of biryani from one JPEG. What does
// work, and what this does, is "inflation": the silhouette is puffed out along
// its medial axis so the middle of the dish rises and the edges taper to zero,
// then the photo's own shading is layered on as fine relief. Front and back
// shells meet at the silhouette, so the result is a closed, solid object that
// holds up when a guest walks around it in AR.

import * as THREE from 'three'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
import { USDZExporter } from 'three/addons/exporters/USDZExporter.js'
import { clamp, luminanceBuffer, blurFloat, toLabBuffer } from './imaging.js'

export const DEFAULT_INFLATE_OPTIONS = {
  widthCm: 24, // real-world width of the dish, drives AR scale
  puffiness: 0.3, // mound height as a fraction of the food's own width
  backDepth: 0.18, // how much of that height the underside gets
  relief: 0.35, // how strongly photo shading becomes surface detail
  gridRes: 128,
  tiltDeg: 90, // 90 = shot from above, 45 = three-quarter, 0 = straight on
  detectPlate: true, // keep a plate in the photo flat instead of doming it
  plate: false, // add a separate 3D plate underneath
}

const ALPHA_CUT = 128

export function buildDishObject(cutout, options = {}) {
  const opts = { ...DEFAULT_INFLATE_OPTIONS, ...options }
  const { width, height } = cutout
  const bbox = alphaBounds(cutout, ALPHA_CUT)
  if (!bbox) throw new Error('Nothing left after background removal — loosen the cut-out.')

  const inside = new Uint8Array(width * height)
  for (let i = 0, p = 3; i < inside.length; i++, p += 4) inside[i] = cutout.data[p] >= ALPHA_CUT ? 1 : 0

  const distance = distanceTransform(inside, width, height)
  const foodMask = opts.detectPlate ? detectFoodMask(cutout, inside, distance) : null
  const foodDistance = foodMask ? distanceTransform(foodMask, width, height) : distance
  const heightMap = buildHeightMap(cutout, distance, foodDistance, opts)

  const geometry = buildShellGeometry({
    cutout,
    heightMap,
    bbox,
    gridRes: Math.round(clamp(opts.gridRes, 48, 320)),
    backDepth: clamp(opts.backDepth, 0, 1),
  })

  // Texture only the dish, not the whole frame. The transparent surround costs
  // almost nothing in a PNG but it is full-price in GPU memory, so cropping to
  // the bounding box is roughly a 2x saving on the device that has least of it.
  const texture = new THREE.CanvasTexture(cropToCanvas(cutout, bbox))
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  texture.needsUpdate = true

  // Front and back shells both taper to zero height at the silhouette, so the
  // object is closed and single-sided rendering is enough. USDZ has no
  // double-sided flag at all, so this also keeps iOS matching the preview.
  const material = new THREE.MeshStandardMaterial({
    map: texture,
    alphaTest: 0.5,
    side: THREE.FrontSide,
    roughness: 0.62,
    metalness: 0.02,
  })

  const mesh = new THREE.Mesh(geometry, material)
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.name = 'dish'

  // Scale the whole thing so the dish measures widthCm across in the real world.
  const pixelsWide = bbox.x1 - bbox.x0
  const metresPerPixel = opts.widthCm / 100 / Math.max(1, pixelsWide)
  mesh.scale.setScalar(metresPerPixel)

  const tilted = new THREE.Group()
  tilted.rotation.x = -THREE.MathUtils.degToRad(clamp(opts.tiltDeg, 0, 90))
  tilted.add(mesh)

  const group = new THREE.Group()
  group.name = 'ar-dish'
  group.add(tilted)

  // Drop the object onto the ground plane so AR placement sits flush on a table.
  const box = new THREE.Box3().setFromObject(tilted)
  tilted.position.y -= box.min.y
  tilted.position.x -= (box.min.x + box.max.x) / 2
  tilted.position.z -= (box.min.z + box.max.z) / 2

  if (opts.plate && opts.tiltDeg > 30) {
    const plate = buildPlate(new THREE.Box3().setFromObject(tilted))
    tilted.position.y += plate.userData.thickness
    group.add(plate)
  }

  return group
}

function buildPlate(box) {
  const size = box.getSize(new THREE.Vector3())
  const radius = Math.max(size.x, size.z) * 0.62
  const thickness = Math.max(0.006, radius * 0.05)
  const geometry = new THREE.CylinderGeometry(radius, radius * 0.82, thickness, 64)
  const material = new THREE.MeshStandardMaterial({
    color: 0xf3f1ec,
    roughness: 0.35,
    metalness: 0.03,
  })
  const plate = new THREE.Mesh(geometry, material)
  plate.name = 'plate'
  plate.position.y = thickness / 2
  plate.receiveShadow = true
  plate.userData.thickness = thickness
  return plate
}

function cropToCanvas(cutout, bbox) {
  const w = bbox.x1 - bbox.x0
  const h = bbox.y1 - bbox.y0
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const patch = new ImageData(w, h)
  for (let y = 0; y < h; y++) {
    const srcRow = (y + bbox.y0) * cutout.width + bbox.x0
    patch.data.set(cutout.data.subarray(srcRow * 4, (srcRow + w) * 4), y * w * 4)
  }
  canvas.getContext('2d').putImageData(patch, 0, 0)
  return canvas
}

function alphaBounds(cutout, cut) {
  const { data, width, height } = cutout
  let x0 = width
  let y0 = height
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] < cut) continue
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
  if (x1 < 0) return null
  return { x0, y0, x1: x1 + 1, y1: y1 + 1 }
}

// Two-pass chamfer distance from every set pixel to the nearest clear pixel.
// Cheap, and the small anisotropy of a 3-4 kernel is invisible once the height
// map is blurred.
function distanceTransform(binary, width, height) {
  const dist = new Float32Array(width * height)
  const FAR = 1e9
  for (let i = 0; i < dist.length; i++) dist[i] = binary[i] ? FAR : 0
  const D1 = 3
  const D2 = 4
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (dist[i] === 0) continue
      let v = dist[i]
      if (y > 0) {
        v = Math.min(v, dist[i - width] + D1)
        if (x > 0) v = Math.min(v, dist[i - width - 1] + D2)
        if (x < width - 1) v = Math.min(v, dist[i - width + 1] + D2)
      }
      if (x > 0) v = Math.min(v, dist[i - 1] + D1)
      dist[i] = v
    }
  }
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const i = y * width + x
      if (dist[i] === 0) continue
      let v = dist[i]
      if (y < height - 1) {
        v = Math.min(v, dist[i + width] + D1)
        if (x > 0) v = Math.min(v, dist[i + width - 1] + D2)
        if (x < width - 1) v = Math.min(v, dist[i + width + 1] + D2)
      }
      if (x < width - 1) v = Math.min(v, dist[i + 1] + D1)
      dist[i] = v
    }
  }
  for (let i = 0; i < dist.length; i++) dist[i] /= D1
  return dist
}

// The silhouette contributes a thin slab with a rounded rim — that is what a
// plate is — and the food region on top of it gets the actual mound. Without
// the split, a wide white plate inflates into a giant dome with the food
// painted on its crown, which is the single worst-looking failure mode here.
function buildHeightMap(cutout, distance, foodDistance, opts) {
  const { width, height } = cutout
  const maxDistance = maxOf(distance) || 1
  const maxFood = maxOf(foodDistance) || 1

  const slab = maxDistance * 2 * 0.022
  const rim = Math.max(2, maxDistance * 0.1)
  // maxFood is the medial-axis radius, so twice it approximates the food width.
  const peak = maxFood * 2 * opts.puffiness

  const luma = luminanceBuffer(cutout)
  const smooth = blurFloat(luma, width, height, Math.max(2, Math.round(Math.min(width, height) / 120)))

  const map = new Float32Array(distance.length)
  for (let i = 0; i < map.length; i++) {
    if (distance[i] <= 0) continue
    const edge = clamp(distance[i] / rim, 0, 1)
    const base = slab * Math.sqrt(Math.max(0, edge * (2 - edge)))

    const n = clamp(foodDistance[i] / maxFood, 0, 1)
    // Circular cross-section: flat-ish crown, fast taper into the silhouette.
    const dome = n > 0 ? Math.sqrt(Math.max(0, n * (2 - n))) : 0
    const detail = (luma[i] - smooth[i]) * opts.relief * dome

    map[i] = base + dome * peak + detail * peak * 0.3
  }
  return blurFloat(map, width, height, 1, 1)
}

function maxOf(buffer) {
  let max = 0
  for (let i = 0; i < buffer.length; i++) if (buffer[i] > max) max = buffer[i]
  return max
}

// Most restaurant photos include the plate. The rim of the silhouette is then
// crockery, not food, so a colour model built from that band separates the two.
// When the band already looks like the food — a burger shot with no plate — the
// split is meaningless and this returns null so the whole silhouette inflates.
function detectFoodMask(cutout, inside, distance) {
  const { width, height } = cutout
  const maxDistance = maxOf(distance)
  if (maxDistance < 8) return null
  const lab = toLabBuffer(cutout)
  const lo = Math.max(1, maxDistance * 0.02)
  const hi = Math.max(lo + 1, maxDistance * 0.14)

  let n = 0
  let sl = 0
  let sa = 0
  let sb = 0
  for (let i = 0; i < inside.length; i++) {
    if (!inside[i] || distance[i] < lo || distance[i] > hi) continue
    const o = i * 3
    sl += lab[o]
    sa += lab[o + 1]
    sb += lab[o + 2]
    n++
  }
  if (n < 64) return null
  const ml = sl / n
  const ma = sa / n
  const mb = sb / n

  let spread = 0
  for (let i = 0; i < inside.length; i++) {
    if (!inside[i] || distance[i] < lo || distance[i] > hi) continue
    spread += labDistance(lab, i, ml, ma, mb)
  }
  const threshold = Math.max(13, (spread / n) * 2.6)

  const mask = new Uint8Array(inside.length)
  let insideCount = 0
  let foodCount = 0
  for (let i = 0; i < inside.length; i++) {
    if (!inside[i]) continue
    insideCount++
    if (labDistance(lab, i, ml, ma, mb) > threshold) {
      mask[i] = 1
      foodCount++
    }
  }
  const ratio = foodCount / Math.max(1, insideCount)
  if (ratio < 0.12 || ratio > 0.86) return null
  return openMask(mask, width, height)
}

function labDistance(lab, index, l, a, b) {
  const o = index * 3
  const dl = lab[o] - l
  const da = lab[o + 1] - a
  const db = lab[o + 2] - b
  return Math.sqrt(dl * dl + da * da + db * db)
}

// One erode/dilate cycle, enough to drop the speckle that colour thresholding
// leaves along a plate rim without eating into the food itself.
function openMask(mask, width, height) {
  const eroded = new Uint8Array(mask.length)
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x
      eroded[i] =
        mask[i] && mask[i - 1] && mask[i + 1] && mask[i - width] && mask[i + width] ? 1 : 0
    }
  }
  const out = new Uint8Array(mask.length)
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x
      out[i] =
        eroded[i] || eroded[i - 1] || eroded[i + 1] || eroded[i - width] || eroded[i + width] ? 1 : 0
    }
  }
  return out
}

function buildShellGeometry({ cutout, heightMap, bbox, gridRes, backDepth }) {
  const { data, width, height } = cutout
  const bw = bbox.x1 - bbox.x0
  const bh = bbox.y1 - bbox.y0
  const cols = gridRes
  const rows = Math.max(8, Math.round((gridRes * bh) / bw))
  const vertsX = cols + 1
  const vertsY = rows + 1
  const perShell = vertsX * vertsY

  const positions = new Float32Array(perShell * 2 * 3)
  const uvs = new Float32Array(perShell * 2 * 2)
  const alphaAt = new Float32Array(perShell)

  const sample = (buffer, fx, fy) => bilinear(buffer, width, height, fx, fy)

  for (let gy = 0; gy < vertsY; gy++) {
    for (let gx = 0; gx < vertsX; gx++) {
      const u = gx / cols
      const v = gy / rows
      const px = bbox.x0 + u * bw
      const py = bbox.y0 + v * bh
      const idx = gy * vertsX + gx

      const a = bilinearAlpha(data, width, height, px, py)
      alphaAt[idx] = a
      const h = a >= ALPHA_CUT ? sample(heightMap, px, py) : 0

      // Photo plane: +X right, +Y up (image rows run downward), +Z toward camera.
      const x = px - (bbox.x0 + bw / 2)
      const y = -(py - (bbox.y0 + bh / 2))

      const f = idx * 3
      positions[f] = x
      positions[f + 1] = y
      positions[f + 2] = h

      const b = (perShell + idx) * 3
      positions[b] = x
      positions[b + 1] = y
      positions[b + 2] = -h * backDepth

      const fu = idx * 2
      uvs[fu] = u
      uvs[fu + 1] = 1 - v
      const bu = (perShell + idx) * 2
      uvs[bu] = uvs[fu]
      uvs[bu + 1] = uvs[fu + 1]
    }
  }

  const indices = []
  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      const a = gy * vertsX + gx
      const b = a + 1
      const c = a + vertsX
      const d = c + 1
      if (alphaAt[a] < ALPHA_CUT && alphaAt[b] < ALPHA_CUT && alphaAt[c] < ALPHA_CUT && alphaAt[d] < ALPHA_CUT) {
        continue
      }
      indices.push(a, c, b, b, c, d)
      const oa = perShell + a
      const ob = perShell + b
      const oc = perShell + c
      const od = perShell + d
      indices.push(oa, ob, oc, ob, od, oc)
    }
  }
  if (!indices.length) throw new Error('The cut-out is too small to build a model from.')

  const geometry = compact(positions, uvs, indices)
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

// Drops the vertices no triangle referenced. Roughly halves the GLB for a
// round dish, which matters when the file is fetched over hotel-lobby wifi.
function compact(positions, uvs, indices) {
  const remap = new Int32Array(positions.length / 3).fill(-1)
  const outPositions = []
  const outUvs = []
  const outIndices = new Uint32Array(indices.length)
  let next = 0
  for (let i = 0; i < indices.length; i++) {
    const v = indices[i]
    if (remap[v] === -1) {
      remap[v] = next++
      outPositions.push(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2])
      outUvs.push(uvs[v * 2], uvs[v * 2 + 1])
    }
    outIndices[i] = remap[v]
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(outPositions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(outUvs, 2))
  geometry.setIndex(new THREE.BufferAttribute(outIndices, 1))
  return geometry
}

function bilinear(buffer, width, height, fx, fy) {
  const x0 = clamp(Math.floor(fx), 0, width - 1)
  const y0 = clamp(Math.floor(fy), 0, height - 1)
  const x1 = Math.min(x0 + 1, width - 1)
  const y1 = Math.min(y0 + 1, height - 1)
  const tx = clamp(fx - x0, 0, 1)
  const ty = clamp(fy - y0, 0, 1)
  const a = buffer[y0 * width + x0]
  const b = buffer[y0 * width + x1]
  const c = buffer[y1 * width + x0]
  const d = buffer[y1 * width + x1]
  return a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty
}

function bilinearAlpha(data, width, height, fx, fy) {
  const x0 = clamp(Math.floor(fx), 0, width - 1)
  const y0 = clamp(Math.floor(fy), 0, height - 1)
  const x1 = Math.min(x0 + 1, width - 1)
  const y1 = Math.min(y0 + 1, height - 1)
  const tx = clamp(fx - x0, 0, 1)
  const ty = clamp(fy - y0, 0, 1)
  const a = data[(y0 * width + x0) * 4 + 3]
  const b = data[(y0 * width + x1) * 4 + 3]
  const c = data[(y1 * width + x0) * 4 + 3]
  const d = data[(y1 * width + x1) * 4 + 3]
  return a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty
}

export function exportGLB(object, meta = {}) {
  return new Promise((resolve, reject) => {
    new GLTFExporter().parse(
      object,
      (result) => resolve(new Blob([result], { type: 'model/gltf-binary' })),
      reject,
      {
        binary: true,
        onlyVisible: true,
        maxTextureSize: 2048,
        ...(Object.keys(meta).length ? { extras: meta } : {}),
      },
    )
  })
}

// iOS opens AR through Quick Look, which reads USDZ and nothing else. three's
// USDZExporter runs in the browser, so the conversion costs no server: it
// writes the texture as PNG (alpha survives) and maps alphaTest onto
// opacityThreshold, which is what carves the dish silhouette on an iPhone.
export function exportUSDZ(object) {
  return new USDZExporter()
    .parseAsync(object, {
      maxTextureSize: 1024,
      includeAnchoringProperties: true,
      ar: { anchoring: { type: 'plane' }, planeAnchoring: { alignment: 'horizontal' } },
    })
    .then((buffer) => new Blob([buffer], { type: 'model/vnd.usdz+zip' }))
}

export function disposeObject(object) {
  object?.traverse?.((child) => {
    if (child.geometry) child.geometry.dispose()
    if (child.material) {
      const materials = Array.isArray(child.material) ? child.material : [child.material]
      for (const material of materials) {
        material.map?.dispose()
        material.dispose()
      }
    }
  })
}
