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
   * tiles always render as a base layer underneath, so areas whose chunk detail
   * hasn't loaded yet (or was evicted at the live-chunk budget) show the overview
   * rather than a black placeholder.
   *
   * Set to 2 (a block spans 2 screen px) — the point where the 16 px/block
   * texture detail first becomes perceptible. Below it the overview carries the
   * look, and since the overview renderer now matches the detailed renderer's
   * colors AND hillshade (see regionTileRenderer), the swap is visually seamless:
   * at ≤2× per-block texture is sub-pixel, so both layers show the same picture.
   *
   * Why not `minScale` (detail everywhere): a zoomed-all-the-way-out view spans
   * far more chunks than the live-chunk budget, so the engine keeps thousands of
   * chunk meshes resident and issues thousands of draw calls per frame — laggy
   * even when idle. Deferring detail to ≥2× keeps the mesh count bounded while
   * the cheap overview (one 512² mesh per 1024 chunks) handles the wide view.
   */
  chunkLodScale: 2,

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
