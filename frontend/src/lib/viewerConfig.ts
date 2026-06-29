/**
 * Tunable world-viewer settings — zoom limits, level-of-detail thresholds,
 * GPU/CPU memory budgets, and loading throughput.  Centralised here so they're
 * easy to adjust without digging through the render code.
 *
 * Scale is world-units → screen-pixels: a chunk is 16 world units, so at
 * scale 1 a chunk is 16 px; larger scale = more zoomed in.
 */
export const VIEWER_CONFIG = {
  // ── Zoom limits ──
  /** Most zoomed-out scale allowed (the furthest you can zoom out). */
  minScale: 1,
  /** Most zoomed-in scale allowed. */
  maxScale: 32,

  // ── Level of detail ──
  /**
   * At/above this scale chunk detail is shown over the region base; below it the
   * detail layer is hidden and only the per-region overview tiles show.  Region
   * tiles always render as a base layer underneath, so gaps in the detail layer
   * show the overview (sharpening into detail) rather than a black placeholder.
   *
   * Default: low-detail overview at the max zoom-out (scale `minScale` = 1.0),
   * full chunk detail from scale 1.25 in (one scroll step).
   */
  chunkLodScale: 1.25,

  /**
   * Chunks loaded beyond the visible viewport, in every direction, so the edge
   * leading a pan is already rendered before it scrolls into view.
   */
  chunkPreloadMargin: 4,
  /**
   * Chunks kept loaded beyond the viewport before eviction (larger than the
   * preload margin, giving hysteresis so panning back doesn't reload).
   */
  chunkEvictMargin: 12,

  // ── GPU budgets (live textures kept on the card) ──
  /** Max live chunk meshes with the pixel filter (~256 KB each). */
  maxLiveChunksPixel: 3500,
  /** Max live chunk meshes with the journeymap filter (512², ~4× the bytes). */
  maxLiveChunksJourneymap: 700,
  /** Max live region overview tiles (512² each). */
  maxRegionTiles: 300,

  // ── CPU cache (rendered tiles kept in RAM for instant restore) ──
  /** Max rendered chunk tiles held in the CPU LRU (~256 KB each). */
  tileCacheMax: 3000,

  // ── Loading / rendering throughput ──
  /** Chunks packed into one bulk request. */
  batchSize: 48,
  /** Concurrent in-flight chunk batches. */
  maxConcurrentBatches: 8,
  /** Concurrent in-flight region-surface fetches. */
  maxConcurrentRegionFetches: 6,
  /** Per-frame time budget for heavy canvas renders (ms). */
  renderBudgetMs: 12,
} as const
