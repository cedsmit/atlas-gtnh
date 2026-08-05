const KNOWN: Record<string, { name: string; color: string }> = {
  gas_natural_gas: { name: 'Natural Gas', color: '#00ffff' },
  oil: { name: 'Oil', color: '#a3a3a3' },
  liquid_light_oil: { name: 'Light Oil', color: '#ffff00' },
  // This is the name Visual Prospecting shows for GT's internal medium-oil key.
  liquid_medium_oil: { name: 'Raw Oil', color: '#00ff00' },
  liquid_heavy_oil: { name: 'Heavy Oil', color: '#737373' },
  liquid_extra_heavy_oil: { name: 'Extra Heavy Oil', color: '#000050' },
  carbondioxide: { name: 'Carbon Dioxide', color: '#696969' },
  carbonmonoxide: { name: 'Carbon Monoxide', color: '#104e8b' },
  chlorobenzene: { name: 'Chlorobenzene', color: '#408040' },
  deuterium: { name: 'Deuterium', color: '#ffe39f' },
  ic2distilledwater: { name: 'Distilled Water', color: '#1e90ff' },
  ethane: { name: 'Ethane', color: '#408020' },
  ethylene: { name: 'Ethylene', color: '#d0d0d0' },
  fluorine: { name: 'Fluorine', color: '#99c1ad' },
  'helium-3': { name: 'Helium-3', color: '#8020e0' },
  hydrofluoricacid_gt5u: { name: 'Hydrofluoric Acid', color: '#00ced1' },
  hydrogen: { name: 'Hydrogen', color: '#3232d6' },
  liquid_hydricsulfur: { name: 'Hydrogen Sulfide', color: '#b5b54a' },
  lava: { name: 'Lava', color: '#ff0000' },
  liquidair: { name: 'Liquid Air', color: '#9999ea' },
  methane: { name: 'Methane', color: '#802020' },
  'molten.copper': { name: 'Molten Copper', color: '#ff7f24' },
  'molten.iron': { name: 'Molten Iron', color: '#8b8878' },
  'molten.lead': { name: 'Molten Lead', color: '#d0d0d0' },
  'molten.tin': { name: 'Molten Tin', color: '#e7e7e4' },
  nitrogen: { name: 'Nitrogen', color: '#0080d0' },
  oxygen: { name: 'Oxygen', color: '#4040a0' },
  saltwater: { name: 'Salt Water', color: '#80ff80' },
  sulfuricacid: { name: 'Sulfuric Acid', color: '#ffb90f' },
  unknowwater: { name: 'Unknown Water', color: '#8a2be2' },
}

function fallbackColor(key: string): string {
  let hash = 0
  for (let i = 0; i < key.length; i++)
    hash = (hash * 31 + key.charCodeAt(i)) | 0
  return `hsl(${Math.abs(hash) % 360} 75% 55%)`
}

export function fluidDisplay(key: string): { name: string; color: string } {
  return (
    KNOWN[key] ?? {
      name: key
        .replace(/^(?:liquid|gas)_/, '')
        .split(/[_.-]+/)
        .filter(Boolean)
        .map((part) => part[0].toUpperCase() + part.slice(1))
        .join(' '),
      color: fallbackColor(key),
    }
  )
}
