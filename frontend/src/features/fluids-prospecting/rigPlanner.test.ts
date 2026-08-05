import { describe, expect, it } from 'vitest'

import type { FluidsProspectingField } from './api/fluidsProspecting'
import { calculateRigRecommendations } from './rigPlanner'

function field(
  chunkX: number,
  chunkZ: number,
  yields: number[],
  source: 'predicted' | 'prospected' = 'predicted'
): FluidsProspectingField {
  const positive = yields.filter((value) => value > 0)
  return {
    x: chunkX * 16 + 64,
    z: chunkZ * 16 + 64,
    chunk_x: chunkX,
    chunk_z: chunkZ,
    fluid: 'oil',
    yields,
    min_yield: positive.length ? Math.min(...positive) : 0,
    max_yield: positive.length ? Math.max(...positive) : 0,
    empty: false,
    source,
  }
}

describe('calculateRigRecommendations', () => {
  it('uses GT grid alignment for negative and positive chunks', () => {
    const yields = Array(64).fill(0)
    yields[0] = 100 // chunk -8, -8
    yields[7 * 8 + 7] = 200 // chunk -1, -1

    const recommendations = calculateRigRecommendations(
      [field(-8, -8, yields)],
      4
    )

    expect(recommendations.map((result) => result.key)).toEqual([
      '-4,-4,4',
      '-8,-8,4',
    ])
    expect(recommendations[0]).toMatchObject({
      controllerChunkX: -1,
      controllerChunkZ: -1,
      baseOutputPerCycle: 100,
    })
  })

  it('ranks areas by exact minimum-tier output and counts current chunks', () => {
    const yields = Array(64).fill(0)
    yields[0] = 101
    yields[1] = 300
    yields[2] = 99

    const [best, second] = calculateRigRecommendations(
      [field(0, 0, yields, 'prospected')],
      2
    )

    expect(best).toMatchObject({
      key: '0,0,2',
      activeChunks: 2,
      prospectedChunks: 2,
      totalYield: 401,
      baseOutputPerCycle: 200,
      estimatedLitersPerSecond: 500,
      controllerChunkX: 0,
      controllerChunkZ: 0,
    })
    expect(second.baseOutputPerCycle).toBe(49)
  })

  it('ignores empty and zero-yield fields', () => {
    const empty = field(0, 0, Array(64).fill(0))
    empty.empty = true

    expect(calculateRigRecommendations([empty], 8)).toEqual([])
  })
})
