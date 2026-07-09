/**
 * Map a pipe/cable block's registry name to a friendly "system" label for the
 * Infrastructure View's per-system filter. Derived from the mod namespace (the
 * part before the ':'), so every pipe/cable mod becomes a toggleable group
 * without any extra tagging.
 */

// Namespaces with a nicer display name than the raw mod id. Matched lower-cased.
const SYSTEM_LABELS: Record<string, string> = {
  appliedenergistics2: 'AE2',
  ae2: 'AE2',
  gregtech: 'GregTech',
  enderio: 'EnderIO',
  thaumcraft: 'Thaumcraft',
  ic2: 'IndustrialCraft',
  thermalexpansion: 'Thermal',
  thermaldynamics: 'Thermal',
  buildcraft: 'BuildCraft',
  buildcrafttransport: 'BuildCraft',
  logisticspipes: 'LogisticsPipes',
  pneumaticcraft: 'PneumaticCraft',
  galacticraftcore: 'Galacticraft',
  extrautils: 'ExtraUtilities',
  extrautilities: 'ExtraUtilities',
  opencomputers: 'OpenComputers',
  railcraft: 'Railcraft',
}

/**
 * Friendly system name for a block name like "Thaumcraft:blockTube" → "Thaumcraft"
 * or "appliedenergistics2:tile.BlockCable" → "AE2". Unknown namespaces are
 * prettified (numeric mod-load prefix stripped, first letter capitalised).
 */
export function pipeSystemName(blockName: string | undefined): string {
  if (!blockName) return 'Other'
  const ci = blockName.indexOf(':')
  const ns = (ci >= 0 ? blockName.slice(0, ci) : blockName).toLowerCase()
  if (SYSTEM_LABELS[ns]) return SYSTEM_LABELS[ns]
  const clean = ns.replace(/^\d+_/, '') // drop a numeric FML load-order prefix
  return clean ? clean[0].toUpperCase() + clean.slice(1) : 'Other'
}
