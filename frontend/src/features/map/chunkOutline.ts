import * as THREE from 'three'

// Per-chunk debug outline overlay: coloured chunk-border loops keyed by "cx,cz",
// shown only in debug mode to visualise each chunk's load/render state.
export type ChunkOutlineState =
  | 'queued'
  | 'rendering'
  | 'loaded'
  | 'empty'
  | 'tainted'
  | 'error'

// Shared across all overlay instances (one live map at a time), so never disposed.
const _unitGeo = new THREE.BufferGeometry()
_unitGeo.setAttribute(
  'position',
  new THREE.BufferAttribute(
    new Float32Array([0, 0, 0, 1, 0, 0, 1, -1, 0, 0, -1, 0]),
    3
  )
)

const _mats: Record<ChunkOutlineState, THREE.LineBasicMaterial> = {
  queued: new THREE.LineBasicMaterial({ color: 0x3399ff, depthTest: false }),
  rendering: new THREE.LineBasicMaterial({ color: 0xffcc00, depthTest: false }),
  loaded: new THREE.LineBasicMaterial({ color: 0x33ee33, depthTest: false }),
  empty: new THREE.LineBasicMaterial({ color: 0x888888, depthTest: false }),
  tainted: new THREE.LineBasicMaterial({ color: 0xcc44ff, depthTest: false }),
  error: new THREE.LineBasicMaterial({ color: 0xff3333, depthTest: false }),
}

export class ChunkOutlineOverlay {
  private readonly lines = new Map<string, THREE.LineLoop>()

  constructor(private readonly scene: THREE.Scene) {}

  /** Set the outline for a chunk, or remove it when *enabled* is false. */
  set(
    key: string,
    mcx: number,
    mcz: number,
    state: ChunkOutlineState,
    enabled: boolean
  ): void {
    const old = this.lines.get(key)
    if (old) this.scene.remove(old)
    if (!enabled) {
      this.lines.delete(key)
      return
    }
    const line = new THREE.LineLoop(_unitGeo, _mats[state])
    line.position.set(mcx * 16, -(mcz * 16), 1)
    line.scale.set(16, 16, 1)
    this.scene.add(line)
    this.lines.set(key, line)
  }

  remove(key: string): void {
    const line = this.lines.get(key)
    if (line) {
      this.scene.remove(line)
      this.lines.delete(key)
    }
  }

  clear(): void {
    for (const line of this.lines.values()) this.scene.remove(line)
    this.lines.clear()
  }
}
