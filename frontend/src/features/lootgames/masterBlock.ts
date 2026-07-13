/**
 * The LootGames dungeon centre/activation block ("Puzzle Master"). One master
 * block marks one dungeon, so finding them locates the dungeons. Numeric FML ids
 * are world-specific, so we resolve this name → id per world from the block-name
 * map (from level.dat's Forge registry) rather than hardcoding an id.
 */
const MASTER_BLOCK_NAME = 'lootgames:LootGamesMasterBlock'

/**
 * Resolve the numeric block id for the LootGames master block in this world, or
 * null if LootGames isn't installed (the name isn't in the registry). Matches the
 * registry name case-insensitively.
 */
export function resolveMasterBlockId(
  blockNames: Record<number, string>
): number | null {
  const target = MASTER_BLOCK_NAME.toLowerCase()
  for (const [id, name] of Object.entries(blockNames)) {
    if (name.toLowerCase() === target) return Number(id)
  }
  return null
}
