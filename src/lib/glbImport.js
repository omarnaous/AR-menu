// Takes the GLB a reconstruction model returns and makes it behave like the
// dishes the studio builds itself: measured in real-world centimetres, centred,
// resting on the ground so AR placement sits flush on a table, and single-sided
// so the USDZ export matches the preview.

import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { buildPlate } from './inflate.js'

export const DEFAULT_IMPORT_OPTIONS = {
  widthCm: 24,
  yawDeg: 0,
  plate: false,
}

export function importDishGlb(arrayBuffer, options = {}) {
  const opts = { ...DEFAULT_IMPORT_OPTIONS, ...options }
  return new Promise((resolve, reject) => {
    new GLTFLoader().parse(
      arrayBuffer,
      '',
      (gltf) => {
        try {
          resolve(place(gltf.scene, opts))
        } catch (cause) {
          reject(cause)
        }
      },
      reject,
    )
  })
}

function place(scene, opts) {
  scene.traverse((child) => {
    if (!child.isMesh) return
    child.castShadow = true
    child.receiveShadow = true
    const materials = Array.isArray(child.material) ? child.material : [child.material]
    for (const material of materials) {
      if (!material) continue
      // USDZ has no double-sided flag, so a double-sided material renders
      // differently on iOS than in the preview. Reconstructed meshes are
      // watertight, which makes front-facing the honest choice.
      material.side = THREE.FrontSide
      material.needsUpdate = true
    }
  })

  const yawed = new THREE.Group()
  yawed.add(scene)
  yawed.rotation.y = THREE.MathUtils.degToRad(opts.yawDeg || 0)

  // Reconstruction output arrives at an arbitrary scale, so measure it and
  // rescale to the dish width the restaurant actually serves.
  const raw = new THREE.Box3().setFromObject(yawed)
  const size = raw.getSize(new THREE.Vector3())
  const widest = Math.max(size.x, size.z, 1e-6)
  scene.scale.multiplyScalar(opts.widthCm / 100 / widest)

  const box = new THREE.Box3().setFromObject(yawed)
  const centre = box.getCenter(new THREE.Vector3())
  scene.position.x -= centre.x
  scene.position.z -= centre.z
  scene.position.y -= box.min.y

  const group = new THREE.Group()
  group.name = 'ar-dish'
  group.add(yawed)

  if (opts.plate) {
    const plate = buildPlate(new THREE.Box3().setFromObject(yawed))
    yawed.position.y += plate.userData.thickness
    group.add(plate)
  }

  return group
}

export function countTriangles(object) {
  let triangles = 0
  object.traverse((child) => {
    if (!child.isMesh) return
    const index = child.geometry.getIndex()
    triangles += (index ? index.count : child.geometry.getAttribute('position').count) / 3
  })
  return Math.round(triangles)
}
