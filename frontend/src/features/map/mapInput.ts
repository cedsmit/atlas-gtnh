// Pointer / keyboard input wiring for the world map. Mutates the shared map
// state (camera, drag, cursor world-pos) and calls back into the effect for
// camera/projection updates. Returns a cleanup that detaches every listener.

export interface MapInputState {
  cam: { cx: number; cz: number; scale: number }
  /** Cursor to return to when a drag ends. Tools override it (e.g. crosshair
   *  while the chunk selector is up), so releasing must not hardcode 'grab'. */
  baseCursor: string
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
  /** Report a double-click; the engine turns it into a world position. The
   *  dialog it opens is React chrome, so it cannot be raised from here. */
  onDoubleClick: (e: MouseEvent) => void
}

/** A drag that moved this far (px) was a pan, not a click. */
const CLICK_SLOP = 4

export function attachMapInput(deps: MapInputDeps): () => void {
  const {
    el,
    inspector,
    state: st,
    updateCam,
    fitCamera,
    getDims,
    minScale,
    maxScale,
    onContextMenu,
    onDoubleClick,
  } = deps

  /** Where the button went down, kept past the release for the menu test. */
  let pressAt: { x: number; y: number } | null = null

  function onMouseDown(e: MouseEvent) {
    st.isDragging = true
    st.lastMouse = { x: e.clientX, y: e.clientY }
    pressAt = { x: e.clientX, y: e.clientY }
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
    el.style.cursor = st.baseCursor
  }
  function onDblClick(e: MouseEvent) {
    e.preventDefault()
    onDoubleClick(e)
  }
  function hideInspector() {
    inspector.style.display = 'none'
  }
  /**
   * The menu belongs to a right *click*, not to a right *drag*.
   *
   * Right-drag pans the map like every other button, but Windows fires
   * `contextmenu` on the button's release — so without this the menu opened at
   * the end of every pan, over wherever the drag happened to stop. The native
   * menu stays suppressed either way.
   */
  function onContextMenuEvent(e: MouseEvent) {
    const moved =
      pressAt &&
      Math.hypot(e.clientX - pressAt.x, e.clientY - pressAt.y) > CLICK_SLOP
    if (moved) {
      e.preventDefault()
      return
    }
    onContextMenu(e)
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
  /** True while the user is typing — the shortcuts must not steal those keys. */
  function isTypingTarget(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null
    if (!el) return false
    const tag = el.tagName
    return (
      tag === 'INPUT' ||
      tag === 'TEXTAREA' ||
      tag === 'SELECT' ||
      el.isContentEditable
    )
  }

  function onKeyDown(e: KeyboardEvent) {
    // This listener is on window, so without the guard an 'f' typed into a
    // search box flies the camera home mid-word. Modifier combos are the app's
    // or the OS's, not ours.
    if (isTypingTarget(e.target)) return
    // A modal owns the keyboard while it is up. Its buttons are not typing
    // targets, so an 'f' with Go focused would otherwise fly the camera behind
    // a dialog the user is still looking at.
    if (document.querySelector('[role="dialog"]')) return
    if (e.ctrlKey || e.metaKey || e.altKey) return
    if (e.key === 'f' || e.key === 'F' || e.key === 'Home') fitCamera()
  }

  el.addEventListener('mousedown', onMouseDown)
  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup', onMouseUp)
  el.addEventListener('mouseleave', onMouseLeave)
  el.addEventListener('wheel', onWheel, { passive: false })
  el.addEventListener('dblclick', onDblClick)
  el.addEventListener('contextmenu', onContextMenuEvent)
  window.addEventListener('mousedown', hideInspector)
  window.addEventListener('keydown', onKeyDown)

  return () => {
    el.removeEventListener('mousedown', onMouseDown)
    window.removeEventListener('mousemove', onMouseMove)
    window.removeEventListener('mouseup', onMouseUp)
    el.removeEventListener('mouseleave', onMouseLeave)
    el.removeEventListener('wheel', onWheel)
    el.removeEventListener('dblclick', onDblClick)
    el.removeEventListener('contextmenu', onContextMenuEvent)
    window.removeEventListener('mousedown', hideInspector)
    window.removeEventListener('keydown', onKeyDown)
  }
}
