/**
 * Display name + colour for a Visual Prospecting vein type (e.g. "ore.mix.gold").
 * The backend enriches each vein with the real GTNH name + representative material
 * colour (from the bundled `ore_vein_dump.json`); those are preferred when present.
 * Otherwise we fall back to a curated table of common GTNH veins, then a stable
 * golden-angle hash — so every vein always gets a distinct, deterministic colour.
 */

interface VeinInfo {
  name: string
  color: string // CSS hex
}

// Curated GTNH ore-mix veins: recognisable colours + friendly names.
const VEINS: Record<string, VeinInfo> = {
  'ore.mix.gold': { name: 'Gold', color: '#e0b83a' },
  'ore.mix.iron': { name: 'Iron', color: '#b0705a' },
  'ore.mix.copper': { name: 'Copper', color: '#c8642d' },
  'ore.mix.tin': { name: 'Tin', color: '#cdd3d8' },
  'ore.mix.lead': { name: 'Lead', color: '#6b6a7d' },
  'ore.mix.nickel': { name: 'Nickel', color: '#a9b3a2' },
  'ore.mix.coal': { name: 'Coal', color: '#4a4a4a' },
  'ore.mix.lignite': { name: 'Lignite', color: '#6b5334' },
  'ore.mix.diamond': { name: 'Diamond', color: '#57d8c6' },
  'ore.mix.lapis': { name: 'Lapis', color: '#3157c4' },
  'ore.mix.redstone': { name: 'Redstone', color: '#c8362a' },
  'ore.mix.mineralsand': { name: 'Mineral Sand', color: '#9a8a68' },
  'ore.mix.oilsand': { name: 'Oil Sand', color: '#33322f' },
  'ore.mix.garnettin': { name: 'Garnet Tin', color: '#a83c4c' },
  'ore.mix.soapstone': { name: 'Soapstone', color: '#8f9a88' },
  'ore.mix.mica': { name: 'Mica', color: '#c1abd4' },
  'ore.mix.salts': { name: 'Salts', color: '#e6e0cc' },
  'ore.mix.kaolinitezeolite': { name: 'Kaolinite Zeolite', color: '#dccfbc' },
  'ore.mix.apatite': { name: 'Apatite', color: '#5fb39a' },
  'ore.mix.manganese': { name: 'Manganese', color: '#a37bc0' },
  'ore.mix.cassiterite': { name: 'Cassiterite', color: '#7a6a5a' },
  'ore.mix.magnetite': { name: 'Magnetite', color: '#4c4c5a' },
  'ore.mix.bauxite': { name: 'Bauxite', color: '#b56a48' },
  'ore.mix.naquadah': { name: 'Naquadah', color: '#2f7a44' },
  'ore.mix.platinum': { name: 'Platinum', color: '#d6d8e6' },
  'ore.mix.molybdenum': { name: 'Molybdenum', color: '#8a8fa0' },
  'ore.mix.tungstate': { name: 'Tungstate', color: '#4d4a55' },
  'ore.mix.sulfur': { name: 'Sulfur', color: '#d8c53a' },
  'ore.mix.saltpeter': { name: 'Saltpeter', color: '#dfe0d4' },
  'ore.mix.uranium': { name: 'Uranium', color: '#4fae3a' },
}

/** Deterministic distinct colour for an unlisted vein, from its name's hash. */
function goldenAngleColor(key: string): string {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0
  const hue = (h * 137.508) % 360
  return `hsl(${hue.toFixed(0)} 60% 62%)`
}

function titleize(material: string): string {
  return material.charAt(0).toUpperCase() + material.slice(1)
}

/** GregTech material colour (0xRRGGBB int, from the dump) → CSS hex. */
function rgbToHex(rgb: number): string {
  return `#${(rgb & 0xffffff).toString(16).padStart(6, '0')}`
}

export interface VeinDisplay {
  name: string
  color: string
}

/**
 * Friendly name + colour for a vein. Prefers the backend-provided GTNH `name` and
 * material `rgb`; otherwise falls back to the curated table, then a hashed
 * colour/name — so an unlisted or dump-less vein still renders distinctly.
 */
export function veinDisplay(
  kind: string,
  name?: string | null,
  rgb?: number | null
): VeinDisplay {
  return {
    name:
      name ?? VEINS[kind]?.name ?? titleize(kind.replace(/^ore\.mix\./, '')),
    color:
      rgb != null
        ? rgbToHex(rgb)
        : (VEINS[kind]?.color ?? goldenAngleColor(kind)),
  }
}
