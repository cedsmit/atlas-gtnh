/**
 * Geometry for the chunk-tool highlights (the selection and the paste preview).
 *
 * A selection is free-form — a set of chunks, not a rectangle — so this builds
 * the *union*: every chunk contributes a fill quad, but an edge only becomes
 * outline when the chunk on the other side of it is not selected. A painted
 * blob then reads as one shape instead of a mesh of squares.
 *
 * The outline is built from quads rather than line segments because WebGL
 * cannot draw a thick line: `linewidth` is silently clamped to 1px by ANGLE
 * (i.e. on Windows), which left the border a hairline over busy terrain.
 *
 * Output is world space, where Y is -Z, matching how the chunk tiles are laid
 * out.
 */

const CHUNK = 16

/** Highlights sit just in front of the tiles they cover. */
const Z = 1

/**
 * Two triangles spanning the corners (*x0*, *y0*) top-left and (*x1*, *y1*)
 * bottom-right — so callers pass x0 < x1 and y0 > y1.
 *
 * Wound counter-clockwise as the camera sees it (+X right, +Y up). This is not
 * cosmetic: Three culls back faces by default, so a clockwise quad here is
 * simply never drawn.
 */
function quad(
  out: number[],
  x0: number,
  y0: number,
  x1: number,
  y1: number
): void {
  out.push(x0, y0, Z, x0, y1, Z, x1, y1, Z)
  out.push(x0, y0, Z, x1, y1, Z, x1, y0, Z)
}

/** Call *edge* for each side of each chunk that no other chunk covers. */
function forEachExposedEdge(
  chunks: readonly [number, number][],
  edge: (x0: number, y0: number, x1: number, y1: number) => void
): void {
  const has = new Set(chunks.map(([cx, cz]) => `${cx},${cz}`))
  for (const [cx, cz] of chunks) {
    const x0 = cx * CHUNK
    const x1 = x0 + CHUNK
    const y0 = -cz * CHUNK // north edge
    const y1 = y0 - CHUNK // south edge
    if (!has.has(`${cx},${cz - 1}`)) edge(x0, y0, x1, y0)
    if (!has.has(`${cx},${cz + 1}`)) edge(x0, y1, x1, y1)
    if (!has.has(`${cx - 1},${cz}`)) edge(x0, y0, x0, y1)
    if (!has.has(`${cx + 1},${cz}`)) edge(x1, y0, x1, y1)
  }
}

/** The translucent interior: two triangles per chunk, flat xyz. */
export function chunkFill(chunks: readonly [number, number][]): number[] {
  const out: number[] = []
  for (const [cx, cz] of chunks) {
    const x = cx * CHUNK
    const y = -cz * CHUNK
    quad(out, x, y, x + CHUNK, y - CHUNK)
  }
  return out
}

/**
 * The union outline, as a band *width* world units thick centred on each
 * exposed edge. Each band overruns its edge by half a width at both ends, so
 * the perpendicular bands at a corner meet square instead of leaving a notch.
 */
export function chunkOutline(
  chunks: readonly [number, number][],
  width: number
): number[] {
  const out: number[] = []
  const half = width / 2
  forEachExposedEdge(chunks, (x0, y0, x1, y1) => {
    if (y0 === y1) quad(out, x0 - half, y0 + half, x1 + half, y0 - half)
    else quad(out, x0 - half, y0 + half, x0 + half, y1 - half)
  })
  return out
}
