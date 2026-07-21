import { describe, expect, it } from 'vitest'

import { collectStaleChunks } from './staleChunks'

// Stand-ins for the engine's cache entries: a drawn tile vs a placeholder.
const DRAWN = { drawn: true }
const EMPTY = { drawn: false }
const isDrawn = (e: { drawn: boolean }) => e.drawn

describe('collectStaleChunks', () => {
  it('marks tiles rendered before the current version', () => {
    const cache = new Map([['0,0', DRAWN]])
    const stale = collectStaleChunks(cache, isDrawn, new Map([['0,0', 3]]), 4)
    expect([...stale]).toEqual(['0,0'])
  })

  it('leaves a tile rendered at the current version alone', () => {
    // The boundary that matters: <= here would re-render every frame forever.
    const cache = new Map([['0,0', DRAWN]])
    const stale = collectStaleChunks(cache, isDrawn, new Map([['0,0', 4]]), 4)
    expect(stale.size).toBe(0)
  })

  it('marks a tile that has never been rendered', () => {
    const cache = new Map([['0,0', DRAWN]])
    expect([...collectStaleChunks(cache, isDrawn, new Map(), 1)]).toEqual([
      '0,0',
    ])
  })

  it('ignores entries that are not drawn tiles', () => {
    // 'empty'/'error' placeholders share the cache but have nothing to redraw.
    const cache = new Map([
      ['0,0', EMPTY],
      ['1,0', DRAWN],
    ])
    const stale = collectStaleChunks(cache, isDrawn, new Map(), 2)
    expect([...stale]).toEqual(['1,0'])
  })

  it('is empty at version 0, so a fresh engine schedules no re-renders', () => {
    const cache = new Map([
      ['0,0', DRAWN],
      ['1,0', DRAWN],
    ])
    expect(collectStaleChunks(cache, isDrawn, new Map(), 0).size).toBe(0)
  })

  it('collects only the out-of-date tiles from a mixed cache', () => {
    const cache = new Map([
      ['0,0', DRAWN],
      ['1,0', DRAWN],
      ['2,0', DRAWN],
    ])
    const renderedAt = new Map([
      ['0,0', 7],
      ['1,0', 2],
    ])
    const stale = collectStaleChunks(cache, isDrawn, renderedAt, 7)
    expect([...stale].sort()).toEqual(['1,0', '2,0'])
  })
})
