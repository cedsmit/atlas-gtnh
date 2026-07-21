import type { OreVeinView } from './OreVeinLabels'

/** Every cached vein of one ore type, as a single browsable entry. */
export interface OreGroup {
  kind: string // VP palette name, e.g. "ore.mix.gold" — the stable identity
  name: string // resolved display name, e.g. "Magnetite & Gold"
  color: string // resolved material colour (CSS hex)
  veins: OreVeinView[] // every cached vein of this ore, in the order given
  depleted: number // how many of those are mined out
}

/**
 * Collapse a dimension's veins into one entry per ore type, so the search panel
 * can list the ores present and drill into a chosen one's veins.
 *
 * Grouped by `kind` rather than display name: the name is a resolved label (and
 * falls back to a hash for an unlisted vein), while `kind` is what the map filter
 * and Visual Prospecting itself key on. Ordered A→Z by name — you come to this
 * list hunting a specific ore, so alphabetical beats most-common-first.
 */
export function groupVeinsByOre(veins: OreVeinView[]): OreGroup[] {
  const byKind = new Map<string, OreGroup>()
  for (const v of veins) {
    let g = byKind.get(v.kind)
    if (!g) {
      g = { kind: v.kind, name: v.name, color: v.color, veins: [], depleted: 0 }
      byKind.set(v.kind, g)
    }
    g.veins.push(v)
    if (v.depleted) g.depleted++
  }
  return [...byKind.values()].sort((a, b) => a.name.localeCompare(b.name))
}
