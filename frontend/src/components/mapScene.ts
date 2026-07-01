import * as THREE from 'three'

interface CameraState {
  cx: number
  cz: number
  scale: number
}

const MAX_GV = 8000 // max grid vertices per layer

/**
 * The Three.js *view* layer for the world map: renderer, scene, orthographic
 * camera, the shared chunk/region geometries + materials, the chunk group, and
 * the region/chunk reference grid.
 *
 * It owns everything needed to turn scene contents into pixels and nothing about
 * *what* to load — the engine adds/removes meshes on `scene`/`chunkGroup` and
 * drives the view via updateCam/updateGrid/render. Keeping the view isolated here
 * is the seam a future 3D view (perspective camera, block meshes) can replace
 * without touching the scheduler/LOD engine.
 */
export class MapScene {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly cam: THREE.OrthographicCamera
  readonly chunkGeo = new THREE.PlaneGeometry(16, 16)
  readonly regionGeo = new THREE.PlaneGeometry(512, 512)
  readonly regionMat = new THREE.MeshBasicMaterial({ color: 0x1a1a24 })
  readonly chunkGroup = new THREE.Group()

  private readonly gridBuf = new Float32Array(MAX_GV * 3)
  private readonly gridAttr = new THREE.BufferAttribute(this.gridBuf, 3)
  private readonly gridGeo = new THREE.BufferGeometry()
  private readonly regionGridMat = new THREE.LineBasicMaterial({ color: 0x2e2e48 })
  private readonly chunkGridBuf = new Float32Array(MAX_GV * 3)
  private readonly chunkGridAttr = new THREE.BufferAttribute(this.chunkGridBuf, 3)
  private readonly chunkGridGeo = new THREE.BufferGeometry()
  private readonly chunkGridMat = new THREE.LineBasicMaterial({ color: 0x1c1c2e })

  constructor(container: HTMLElement, w: number, h: number) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false })
    this.renderer.setSize(w, h)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    container.appendChild(this.renderer.domElement)
    this.renderer.domElement.style.cursor = 'grab'

    this.scene.background = new THREE.Color(0x0f0f0f)
    this.cam = new THREE.OrthographicCamera(-w / 2, w / 2, h / 2, -h / 2, 0.1, 2000)
    this.scene.add(this.chunkGroup)

    this.gridAttr.setUsage(THREE.DynamicDrawUsage)
    this.gridGeo.setAttribute('position', this.gridAttr)
    const regionGridLines = new THREE.LineSegments(this.gridGeo, this.regionGridMat)
    regionGridLines.frustumCulled = false
    this.scene.add(regionGridLines)

    this.chunkGridAttr.setUsage(THREE.DynamicDrawUsage)
    this.chunkGridGeo.setAttribute('position', this.chunkGridAttr)
    const chunkGridLines = new THREE.LineSegments(this.chunkGridGeo, this.chunkGridMat)
    chunkGridLines.frustumCulled = false
    this.scene.add(chunkGridLines)
  }

  get domElement(): HTMLCanvasElement {
    return this.renderer.domElement
  }

  /** Reproject the orthographic camera for the current centre/zoom + viewport. */
  updateCam(cam: CameraState, w: number, h: number): void {
    const { cx, cz, scale } = cam
    const halfW = w / (2 * scale),
      halfH = h / (2 * scale)
    this.cam.left = -halfW
    this.cam.right = halfW
    this.cam.top = halfH
    this.cam.bottom = -halfH
    this.cam.position.set(cx, -cz, 500)
    this.cam.lookAt(cx, -cz, 0)
    this.cam.updateProjectionMatrix()
  }

  /** Rebuild the region grid (always) and chunk grid (when zoomed in) for the view. */
  updateGrid(cam: CameraState, w: number, h: number): void {
    const { cx, cz, scale } = cam
    const halfW = w / (2 * scale),
      halfH = h / (2 * scale)
    const gridBuf = this.gridBuf,
      chunkGridBuf = this.chunkGridBuf
    const rL = Math.floor((cx - halfW) / 512) - 1,
      rR = Math.ceil((cx + halfW) / 512) + 1
    const rT = Math.floor((cz - halfH) / 512) - 1,
      rB = Math.ceil((cz + halfH) / 512) + 1

    let vi = 0
    for (let rx = rL; rx <= rR && vi < MAX_GV - 6; rx++) {
      const x = rx * 512
      gridBuf[vi++] = x; gridBuf[vi++] = -(rT * 512 - 512); gridBuf[vi++] = 0.5
      gridBuf[vi++] = x; gridBuf[vi++] = -(rB * 512 + 512); gridBuf[vi++] = 0.5
    }
    for (let rz = rT; rz <= rB && vi < MAX_GV - 6; rz++) {
      const y = -(rz * 512)
      gridBuf[vi++] = rL * 512 - 512; gridBuf[vi++] = y; gridBuf[vi++] = 0.5
      gridBuf[vi++] = rR * 512 + 512; gridBuf[vi++] = y; gridBuf[vi++] = 0.5
    }
    this.gridAttr.needsUpdate = true
    this.gridGeo.setDrawRange(0, vi / 3)

    let ci = 0
    if (scale >= 3) {
      const cL = Math.floor((cx - halfW) / 16) - 1,
        cR = Math.ceil((cx + halfW) / 16) + 1
      const cT = Math.floor((cz - halfH) / 16) - 1,
        cB = Math.ceil((cz + halfH) / 16) + 1
      for (let chx = cL; chx <= cR && ci < MAX_GV - 6; chx++) {
        const x = chx * 16
        chunkGridBuf[ci++] = x; chunkGridBuf[ci++] = -(cT * 16 - 16); chunkGridBuf[ci++] = 0.5
        chunkGridBuf[ci++] = x; chunkGridBuf[ci++] = -(cB * 16 + 16); chunkGridBuf[ci++] = 0.5
      }
      for (let chz = cT; chz <= cB && ci < MAX_GV - 6; chz++) {
        const y = -(chz * 16)
        chunkGridBuf[ci++] = cL * 16 - 16; chunkGridBuf[ci++] = y; chunkGridBuf[ci++] = 0.5
        chunkGridBuf[ci++] = cR * 16 + 16; chunkGridBuf[ci++] = y; chunkGridBuf[ci++] = 0.5
      }
    }
    this.chunkGridAttr.needsUpdate = true
    this.chunkGridGeo.setDrawRange(0, ci / 3)
  }

  render(): void {
    this.renderer.render(this.scene, this.cam)
  }

  resize(w: number, h: number): void {
    this.renderer.setSize(w, h)
  }

  dispose(): void {
    this.regionMat.dispose()
    this.chunkGeo.dispose()
    this.regionGeo.dispose()
    this.gridGeo.dispose()
    this.chunkGridGeo.dispose()
    this.regionGridMat.dispose()
    this.chunkGridMat.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}
