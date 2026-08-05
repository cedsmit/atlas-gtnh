import { describe, expect, it } from 'vitest'

import type { BedrockFluidField } from './api/bedrockFluids'
import {
  EMPTY_FLUID_GROUP,
  fluidGroupKey,
  groupFieldsByFluid,
} from './fluidGroups'

function field(
  fluid: string,
  source: 'predicted' | 'prospected',
  empty = false
): BedrockFluidField {
  return {
    x: 64,
    z: 64,
    chunk_x: 0,
    chunk_z: 0,
    fluid,
    yields: empty ? [0] : [10],
    min_yield: empty ? 0 : 10,
    max_yield: empty ? 0 : 10,
    empty,
    source,
  }
}

describe('groupFieldsByFluid', () => {
  it('groups fluid fields and counts predicted versus current', () => {
    const groups = groupFieldsByFluid([
      field('oil', 'predicted'),
      field('oil', 'prospected'),
      field('gas_natural_gas', 'predicted'),
    ])

    expect(groups.map((group) => group.name)).toEqual(['Natural Gas', 'Oil'])
    expect(groups[1]).toMatchObject({ predicted: 1, prospected: 1 })
  })

  it('puts all empty fields in one group at the end', () => {
    const emptyOil = field('oil', 'prospected', true)
    const emptyGas = field('gas_natural_gas', 'predicted', true)
    const groups = groupFieldsByFluid([
      emptyOil,
      field('oil', 'predicted'),
      emptyGas,
    ])

    expect(groups[groups.length - 1]).toMatchObject({
      key: EMPTY_FLUID_GROUP,
      name: 'Empty',
      fields: [emptyOil, emptyGas],
    })
    expect(fluidGroupKey(emptyGas)).toBe(EMPTY_FLUID_GROUP)
  })
})
