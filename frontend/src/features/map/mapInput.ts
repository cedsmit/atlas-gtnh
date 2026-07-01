// Pointer / keyboard input wiring for the world map. Mutates the shared map
// state (camera, drag, cursor world-pos) and calls back into the effect for
// camera/projection updates. Returns a cleanup that detaches every listener.

export interface MapInputState {
  cam: { cx: number; cz: number; scale: number }
  isDragging: boolean
  lastMouse: { x: number; y: number } | null
  mouseWorldX: number | null
  mouseWorldZ: number | null
  pending: { length: number }
  pendingSet: { clear(): void }
}

export interface MapInputDeps {
  el: HTMLElement
  inspector: HTMLElement
  state: MapInputState
  updateCam: () => void
  fitCamera: () => void
  getDims: () => { w: number; h: number }
  minScale: number
  maxScale: number
  onContextMenu: (e: MouseEvent) => void
}

export function attachMapInput(deps: MapInputDeps): () => void {
  const { el, inspector, state: st, updateCam, fitCamera, getDims, minScale, maxScale, onContextMenu } = deps

  function onMouseDown(e: MouseEvent) {
    st.isDragging = true
    st.lastMouse = { x: e.clientX, y: e.clientY }
    el.style.cursor = 'grabbing'
  }
  function onMouseMove(e: MouseEvent) {
    const rect = el.getBoundingClientRect()
    const { w: W, h: H } = getDims()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    st.mouseWorldX = st.cam.cx + (mx - W / 2) / st.cam.scale
    st.mouseWorldZ = st.cam.cz + (my - H / 2) / st.cam.scale

    if (!st.isDragging || !st.lastMouse) return
    st.cam.cx -= (e.clientX - st.lastMouse.x) / st.cam.scale
    st.cam.cz -= (e.clientY - st.lastMouse.y) / st.cam.scale
    st.lastMouse = { x: e.clientX, y: e.clientY }
    st.pending.length = 0
    st.pendingSet.clear()
    updateCam()
  }
  function onMouseLeave() {
    st.mouseWorldX = null
    st.mouseWorldZ = null
  }
  function onMouseUp() {
    st.isDragging = false
    st.lastMouse = null
    el.style.cursor = 'grab'
  }
  function onDblClick(e: MouseEvent) {
    e.preventDefault()
    const input = prompt('Go to coordinates — enter X, Z:')
    if (!input) return
    const parts = input.split(',').map((p) => parseFloat(p.trim()))
    if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      st.cam.cx = parts[0]
      st.cam.cz = parts[1]
      st.cam.scale = Math.max(st.cam.scale, minScale)
      updateCam()
    }
  }
  function hideInspector() {
    inspector.style.display = 'none'
  }
  function onWheel(e: WheelEvent) {
    e.preventDefault()
    const rect = el.getBoundingClientRect()
    const { w: W, h: H } = getDims()
    const mx = e.clientX - rect.left,
      my = e.clientY - rect.top
    const worldX = st.cam.cx + (mx - W / 2) / st.cam.scale
    const worldZ = st.cam.cz + (my - H / 2) / st.cam.scale
    const factor = e.deltaY < 0 ? 1.25 : 1 / 1.25
    st.cam.scale = Math.max(minScale, Math.min(maxScale, st.cam.scale * factor))
    st.cam.cx = worldX - (mx - W / 2) / st.cam.scale
    st.cam.cz = worldZ - (my - H / 2) / st.cam.scale
    st.pending.length = 0
    st.pendingSet.clear()
    updateCam()
  }
  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'f' || e.key === 'F' || e.key === 'Home') fitCamera()
  }

  el.addEventListener('mousedown', onMouseDown)
  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup', onMouseUp)
  el.addEventListener('mouseleave', onMouseLeave)
  el.addEventListener('wheel', onWheel, { passive: false })
  el.addEventListener('dblclick', onDblClick)
  el.addEventListener('contextmenu', onContextMenu)
  window.addEventListener('mousedown', hideInspector)
  window.addEventListener('keydown', onKeyDown)

  return () => {
    el.removeEventListener('mousedown', onMouseDown)
    window.removeEventListener('mousemove', onMouseMove)
    window.removeEventListener('mouseup', onMouseUp)
    el.removeEventListener('mouseleave', onMouseLeave)
    el.removeEventListener('wheel', onWheel)
    el.removeEventListener('dblclick', onDblClick)
    el.removeEventListener('contextmenu', onContextMenu)
    window.removeEventListener('mousedown', hideInspector)
    window.removeEventListener('keydown', onKeyDown)
  }
}
