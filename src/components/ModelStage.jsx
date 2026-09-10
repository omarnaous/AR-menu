import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'

// Live three.js preview of the inflated dish. Same lighting model the AR viewer
// uses, so what a chef approves here is what a guest sees on the table.
const ModelStage = forwardRef(function ModelStage({ object, busy, busyLabel }, ref) {
  const mountRef = useRef(null)
  const stateRef = useRef(null)

  useEffect(() => {
    const mount = mountRef.current
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.05
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    mount.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x141924)

    const pmrem = new THREE.PMREMGenerator(renderer)
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.05).texture

    const key = new THREE.DirectionalLight(0xffffff, 2.1)
    key.position.set(0.6, 1.4, 0.9)
    key.castShadow = true
    key.shadow.mapSize.set(1024, 1024)
    key.shadow.camera.near = 0.05
    key.shadow.camera.far = 6
    key.shadow.camera.left = -0.6
    key.shadow.camera.right = 0.6
    key.shadow.camera.top = 0.6
    key.shadow.camera.bottom = -0.6
    key.shadow.bias = -0.0012
    scene.add(key)
    scene.add(new THREE.AmbientLight(0xffffff, 0.35))

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(4, 4),
      new THREE.ShadowMaterial({ opacity: 0.32 }),
    )
    ground.rotation.x = -Math.PI / 2
    ground.receiveShadow = true
    scene.add(ground)

    const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 40)
    camera.position.set(0.35, 0.32, 0.55)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.minDistance = 0.12
    controls.maxDistance = 3
    controls.maxPolarAngle = Math.PI / 2 - 0.02

    const holder = new THREE.Group()
    scene.add(holder)

    const resize = () => {
      const { clientWidth, clientHeight } = mount
      if (!clientWidth || !clientHeight) return
      renderer.setSize(clientWidth, clientHeight, false)
      camera.aspect = clientWidth / clientHeight
      camera.updateProjectionMatrix()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(mount)
    resize()

    let frame = 0
    const tick = () => {
      frame = requestAnimationFrame(tick)
      controls.update()
      renderer.render(scene, camera)
    }
    tick()

    stateRef.current = { renderer, scene, camera, controls, holder, key, render: () => renderer.render(scene, camera) }

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      controls.dispose()
      pmrem.dispose()
      renderer.dispose()
      mount.removeChild(renderer.domElement)
      stateRef.current = null
    }
  }, [])

  useEffect(() => {
    const state = stateRef.current
    if (!state) return
    state.holder.clear()
    if (!object) return
    state.holder.add(object)

    const box = new THREE.Box3().setFromObject(object)
    const size = box.getSize(new THREE.Vector3())
    const centre = box.getCenter(new THREE.Vector3())
    const radius = Math.max(size.length() / 2, 0.05)

    state.controls.target.set(centre.x, size.y * 0.45, centre.z)
    state.camera.position.set(centre.x + radius * 1.1, size.y * 0.45 + radius * 1.0, centre.z + radius * 1.6)
    state.camera.near = radius / 40
    state.camera.far = radius * 60
    state.camera.updateProjectionMatrix()
    state.controls.update()

    state.key.position.set(radius * 1.2, radius * 2.4, radius * 1.6)
    state.key.shadow.camera.left = -radius * 1.6
    state.key.shadow.camera.right = radius * 1.6
    state.key.shadow.camera.top = radius * 1.6
    state.key.shadow.camera.bottom = -radius * 1.6
    state.key.shadow.camera.far = radius * 8
    state.key.shadow.camera.updateProjectionMatrix()
  }, [object])

  useImperativeHandle(ref, () => ({
    // Rendered on demand so the buffer is guaranteed fresh at capture time.
    captureThumbnail(type = 'image/jpeg', quality = 0.82) {
      const state = stateRef.current
      if (!state) return Promise.resolve(null)
      state.render()
      return new Promise((resolve) => state.renderer.domElement.toBlob(resolve, type, quality))
    },
  }))

  return (
    <div className="stage viewer viewport" style={{ position: 'relative' }}>
      <div ref={mountRef} style={{ width: '100%', height: '100%' }} />
      {busy && (
        <div className="busy">
          <div className="spinner" />
          <span>{busyLabel}</span>
        </div>
      )}
    </div>
  )
})

export default ModelStage
