import * as THREE from 'three'
import { ATLAS, threeColor } from '../../shared/theme'
import { chunkFill, chunkOutline } from './chunkHighlight'

interface CameraState {
  cx: number
  cz: number
  scale: number
}

const MAX_GV = 8000 // max grid vertices per layer

/**
 * Render order for the chunk-tool highlights. Above every overlay the engine
 * draws (search 1000, ore veins 1001, their labels up to 1003) — you are
 * pointing at these, so nothing should cover them.
 */
const HIGHLIGHT_ORDER = 1010

/**
 * Highlight outline thickness, in CSS pixels. Held constant on screen — the
 * geometry is rebuilt when the zoom changes — because a world-space thickness
 * that reads well over a base is a hairline once you zoom out to find it.
 */
const OUTLINE_PX = 3.5

/** How far the dark backing extends past the outline on each side, in CSS px. */
const HALO_PX = 1.5

/** Positions → a geometry. */
function geometryOf(positions: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  g.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array(positions), 3)
  )
  return g
}

/**
 * A chunk-set highlight: translucent fill, a dark backing band, and the accent
 * outline on top of it. The backing is what keeps the border legible over both
 * dark forest and pale sand — accent-on-green alone nearly disappears.
 */
interface ChunkHighlight {
  fill: THREE.Mesh
  halo: THREE.Mesh
  line: THREE.Mesh
  chunks: readonly [number, number][]
}

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
  private readonly regionGridMat = new THREE.LineBasicMaterial({
    color: 0x2e2e48,
  })
  private readonly chunkGridBuf = new Float32Array(MAX_GV * 3)
  private readonly chunkGridAttr = new THREE.BufferAttribute(
    this.chunkGridBuf,
    3
  )
  private readonly chunkGridGeo = new THREE.BufferGeometry()
  private readonly chunkGridMat = new THREE.LineBasicMaterial({
    color: 0x1c1c2e,
  })

  private readonly selectionMat = new THREE.MeshBasicMaterial({
    color: threeColor(ATLAS.accent),
    depthTest: false,
    transparent: true,
  })
  private readonly selectionFillMat = new THREE.MeshBasicMaterial({
    color: threeColor(ATLAS.accent),
    depthTest: false,
    transparent: true,
    opacity: 0.2,
  })
  // Same accent as the selection. The two are never on screen together —
  // entering paste mode clears the selection — so a second hue bought no
  // distinction and only put a colour on the map that appears nowhere else in
  // the app. The lighter fill is what separates a pending paste from a
  // committed selection.
  private readonly previewMat = new THREE.MeshBasicMaterial({
    color: threeColor(ATLAS.accent),
    depthTest: false,
    transparent: true,
  })
  private readonly previewFillMat = new THREE.MeshBasicMaterial({
    color: threeColor(ATLAS.accent),
    depthTest: false,
    transparent: true,
    opacity: 0.12,
  })
  // One backing for both: near-black, so the accent band has an edge against
  // whatever terrain is under it. Shared because the two highlights are never
  // on screen together.
  private readonly haloMat = new THREE.MeshBasicMaterial({
    color: threeColor(ATLAS.bg),
    depthTest: false,
    transparent: true,
    opacity: 0.65,
  })
  private regionGridLines!: THREE.LineSegments
  private chunkGridLines!: THREE.LineSegments
  private selection!: ChunkHighlight
  private preview!: ChunkHighlight
  /** Last camera zoom, so the outlines can be rebuilt to keep their px width. */
  private camScale = 1

  constructor(container: HTMLElement, w: number, h: number) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false })
    this.renderer.setSize(w, h)
    // Floor the backing resolution at 1.25× so lower-DPR (100%) displays get the
    // same mipmap crispness as a 1.25-DPR one — otherwise block textures sample a
    // higher (blurrier) mip level at the same zoom and read paler.
    this.renderer.setPixelRatio(
      Math.min(Math.max(window.devicePixelRatio, 1.25), 2)
    )
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    container.appendChild(this.renderer.domElement)
    this.renderer.domElement.style.cursor = 'grab'

    // Same token the shell paints with, so the map sits in the window rather
    // than on a slightly different panel, and re-theming moves both together.
    // Also sits well clear of the 0x1a1a24 region placeholder, so empty space
    // reads as "no world here" rather than "region known, tile not drawn yet".
    this.scene.background = new THREE.Color(threeColor(ATLAS.bg))
    this.cam = new THREE.OrthographicCamera(
      -w / 2,
      w / 2,
      h / 2,
      -h / 2,
      0.1,
      2000
    )
    this.scene.add(this.chunkGroup)

    this.gridAttr.setUsage(THREE.DynamicDrawUsage)
    this.gridGeo.setAttribute('position', this.gridAttr)
    this.regionGridLines = new THREE.LineSegments(
      this.gridGeo,
      this.regionGridMat
    )
    this.regionGridLines.frustumCulled = false
    this.scene.add(this.regionGridLines)

    this.chunkGridAttr.setUsage(THREE.DynamicDrawUsage)
    this.chunkGridGeo.setAttribute('position', this.chunkGridAttr)
    this.chunkGridLines = new THREE.LineSegments(
      this.chunkGridGeo,
      this.chunkGridMat
    )
    this.chunkGridLines.frustumCulled = false
    this.scene.add(this.chunkGridLines)

    // Selection + paste-preview highlights: a fill, a backing and an outline
    // each, whose geometry is rebuilt from the chunks they cover.
    this.selection = this.addHighlight(
      this.selectionFillMat,
      this.selectionMat,
      HIGHLIGHT_ORDER
    )
    this.preview = this.addHighlight(
      this.previewFillMat,
      this.previewMat,
      HIGHLIGHT_ORDER + 3
    )
  }

  /**
   * A chunk highlight, drawn above every other overlay.
   *
   * The explicit render order is load-bearing, not a nicety: `depthTest: false`
   * alone puts these *behind* the map. Three sorts opaque draws by render order,
   * then material id, then depth — so without one, these materials (created with
   * the scene, hence low ids) go out before the chunk tiles, and turning off the
   * depth test also stops them writing depth, leaving nothing to mask the tiles
   * that follow. The grid escapes this only because it still depth-tests.
   */
  private addHighlight(
    fillMat: THREE.Material,
    lineMat: THREE.Material,
    renderOrder: number
  ): ChunkHighlight {
    const h: ChunkHighlight = {
      fill: new THREE.Mesh(new THREE.BufferGeometry(), fillMat),
      halo: new THREE.Mesh(new THREE.BufferGeometry(), this.haloMat),
      line: new THREE.Mesh(new THREE.BufferGeometry(), lineMat),
      chunks: [],
    }
    h.fill.renderOrder = renderOrder
    // All three are transparent, so they share a queue and this ordering is
    // real: fill, then the backing, then the outline on top of it.
    h.halo.renderOrder = renderOrder + 1
    h.line.renderOrder = renderOrder + 2
    for (const o of [h.fill, h.halo, h.line]) {
      o.frustumCulled = false
      o.visible = false
      this.scene.add(o)
    }
    return h
  }

  /**
   * Rebuild a highlight to cover exactly the chunks it holds, or hide it when
   * empty. Outline width is derived from the zoom, so it stays the same on
   * screen however far out the view is.
   */
  private rebuild(h: ChunkHighlight): void {
    const width = OUTLINE_PX / this.camScale
    const halo = width + (2 * HALO_PX) / this.camScale
    for (const o of [h.fill, h.halo, h.line]) o.geometry.dispose()
    h.fill.geometry = geometryOf(chunkFill(h.chunks))
    h.halo.geometry = geometryOf(chunkOutline(h.chunks, halo))
    h.line.geometry = geometryOf(chunkOutline(h.chunks, width))
    const on = h.chunks.length > 0
    h.fill.visible = h.halo.visible = h.line.visible = on
  }

  /** Draw (or hide, when null/empty) the selection highlight over these chunks. */
  setSelectionChunks(chunks: readonly [number, number][] | null): void {
    this.selection.chunks = chunks ?? []
    this.rebuild(this.selection)
  }

  /** Draw (or hide, when null/empty) the paste-preview highlight over these chunks. */
  setPreviewChunks(chunks: readonly [number, number][] | null): void {
    this.preview.chunks = chunks ?? []
    this.rebuild(this.preview)
  }

  /**
   * Show or hide the reference grid. The lines keep one colour in both visible
   * states — adding coordinate labels is the only difference — so brightening
   * them would make the map's shading read differently for no reason.
   */
  setGridVisible(visible: boolean): void {
    this.regionGridLines.visible = visible
    this.chunkGridLines.visible = visible
  }

  get domElement(): HTMLCanvasElement {
    return this.renderer.domElement
  }

  /** Reproject the orthographic camera for the current centre/zoom + viewport. */
  updateCam(cam: CameraState, w: number, h: number): void {
    const { cx, cz, scale } = cam
    // Panning leaves the highlights alone; only a zoom changes how thick their
    // outlines have to be in world units to stay the same on screen.
    if (scale !== this.camScale) {
      this.camScale = scale
      for (const highlight of [this.selection, this.preview])
        if (highlight.chunks.length) this.rebuild(highlight)
    }
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
      gridBuf[vi++] = x
      gridBuf[vi++] = -(rT * 512 - 512)
      gridBuf[vi++] = 0.5
      gridBuf[vi++] = x
      gridBuf[vi++] = -(rB * 512 + 512)
      gridBuf[vi++] = 0.5
    }
    for (let rz = rT; rz <= rB && vi < MAX_GV - 6; rz++) {
      const y = -(rz * 512)
      gridBuf[vi++] = rL * 512 - 512
      gridBuf[vi++] = y
      gridBuf[vi++] = 0.5
      gridBuf[vi++] = rR * 512 + 512
      gridBuf[vi++] = y
      gridBuf[vi++] = 0.5
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
        chunkGridBuf[ci++] = x
        chunkGridBuf[ci++] = -(cT * 16 - 16)
        chunkGridBuf[ci++] = 0.5
        chunkGridBuf[ci++] = x
        chunkGridBuf[ci++] = -(cB * 16 + 16)
        chunkGridBuf[ci++] = 0.5
      }
      for (let chz = cT; chz <= cB && ci < MAX_GV - 6; chz++) {
        const y = -(chz * 16)
        chunkGridBuf[ci++] = cL * 16 - 16
        chunkGridBuf[ci++] = y
        chunkGridBuf[ci++] = 0.5
        chunkGridBuf[ci++] = cR * 16 + 16
        chunkGridBuf[ci++] = y
        chunkGridBuf[ci++] = 0.5
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
    for (const h of [this.selection, this.preview])
      for (const o of [h.fill, h.halo, h.line]) o.geometry.dispose()
    this.haloMat.dispose()
    this.selectionMat.dispose()
    this.selectionFillMat.dispose()
    this.previewMat.dispose()
    this.previewFillMat.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}
