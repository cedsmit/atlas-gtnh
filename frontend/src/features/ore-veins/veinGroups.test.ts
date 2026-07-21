import { describe, expect, it } from 'vitest'

import type { OreVeinView } from './OreVeinLabels'
import { groupVeinsByOre } from './veinGroups'

/** Build a vein of `kind` named `name` at (x, z). */
function vein(
  kind: string,
  name: string,
  x: number,
  z: number,
  depleted = false
): OreVeinView {
  return { kind, name, x, z, depleted, color: '#ffffff' }
}

describe('groupVeinsByOre', () => {
  it('returns nothing for no veins', () => {
    expect(groupVeinsByOre([])).toEqual([])
  })

  it('collects every vein of one ore into a single group', () => {
    const groups = groupVeinsByOre([
      vein('ore.mix.gold', 'Gold', 0, 0),
      vein('ore.mix.gold', 'Gold', 48, 48),
      vein('ore.mix.gold', 'Gold', 96, 96),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].kind).toBe('ore.mix.gold')
    expect(groups[0].veins).toHaveLength(3)
  })

  it('counts depleted veins without dropping them from the group', () => {
    const groups = groupVeinsByOre([
      vein('ore.mix.gold', 'Gold', 0, 0, true),
      vein('ore.mix.gold', 'Gold', 48, 48),
      vein('ore.mix.gold', 'Gold', 96, 96, true),
    ])
    expect(groups[0].depleted).toBe(2)
    expect(groups[0].veins).toHaveLength(3)
  })

  it('orders groups A→Z by display name, not by kind or insertion', () => {
    const groups = groupVeinsByOre([
      vein('ore.mix.tin', 'Tin', 0, 0),
      vein('ore.mix.apatite', 'Apatite', 48, 0),
      vein('ore.mix.gold', 'Magnetite & Gold', 96, 0),
    ])
    expect(groups.map((g) => g.name)).toEqual([
      'Apatite',
      'Magnetite & Gold',
      'Tin',
    ])
  })

  it('keeps same-named veins of different kinds apart', () => {
    // Display names can collide (or fall back to a hash); `kind` is the identity
    // the map filter keys on, so grouping must follow it.
    const groups = groupVeinsByOre([
      vein('ore.mix.gold', 'Gold', 0, 0),
      vein('ore.mix.gold_alt', 'Gold', 48, 48),
    ])
    expect(groups).toHaveLength(2)
    expect(groups.map((g) => g.kind)).toEqual([
      'ore.mix.gold',
      'ore.mix.gold_alt',
    ])
  })

  it('preserves the given vein order within a group', () => {
    // The panel hands veins to sortByDistanceFromHome afterwards; grouping must
    // not impose its own order, so a no-home list stays in the backend's order.
    const groups = groupVeinsByOre([
      vein('ore.mix.gold', 'Gold', 300, 300),
      vein('ore.mix.gold', 'Gold', 0, 0),
      vein('ore.mix.gold', 'Gold', 150, 150),
    ])
    expect(groups[0].veins.map((v) => v.x)).toEqual([300, 0, 150])
  })
})
