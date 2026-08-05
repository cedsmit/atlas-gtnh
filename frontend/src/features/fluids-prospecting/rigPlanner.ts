import type { FluidsProspectingField } from './api/fluidsProspecting'

export type OilDrillingRigTier = 'I' | 'II' | 'III' | 'IV'

export interface OilDrillingRigDefinition {
  tier: OilDrillingRigTier
  voltage: 'MV' | 'HV' | 'EV' | 'IV'
  range: 1 | 2 | 4 | 8
}

export const OIL_DRILLING_RIGS: readonly OilDrillingRigDefinition[] = [
  { tier: 'I', voltage: 'MV', range: 1 },
  { tier: 'II', voltage: 'HV', range: 2 },
  { tier: 'III', voltage: 'EV', range: 4 },
  { tier: 'IV', voltage: 'IV', range: 8 },
]

export interface RigRecommendation {
  key: string
  range: number
  areaChunkX: number
  areaChunkZ: number
  controllerChunkX: number
  controllerChunkZ: number
  x: number
  z: number
  activeChunks: number
  prospectedChunks: number
  totalYield: number
  baseOutputPerCycle: number
  estimatedLitersPerSecond: number
}

interface FluidChunk {
  chunkX: number
  chunkZ: number
  value: number
  prospected: boolean
}

const MAX_RECOMMENDATIONS = 100

function floorDiv(value: number, divisor: number): number {
  return Math.floor(value / divisor)
}

/**
 * Rank GT Oil Drilling Rig work areas for one selected fluid.
 *
 * GT aligns every NxN area to the global N-chunk grid and chooses the pumped
 * fluid from the controller chunk. At minimum voltage the speed coefficient is
 * 0.5 and every tier has an 8-tick base cycle, so floor(chunkYield / 2) is the
 * exact displayed-data contribution per cycle and output/8*20 gives L/s.
 */
export function calculateRigRecommendations(
  fields: FluidsProspectingField[],
  range: number
): RigRecommendation[] {
  if (range < 1) return []
  const chunks = new Map<string, FluidChunk>()
  for (const field of fields) {
    if (field.empty || field.yields.length !== 64) continue
    for (let localZ = 0; localZ < 8; localZ++) {
      for (let localX = 0; localX < 8; localX++) {
        const value = field.yields[localZ * 8 + localX] ?? 0
        if (value <= 0) continue
        const chunkX = field.chunk_x + localX
        const chunkZ = field.chunk_z + localZ
        chunks.set(`${chunkX},${chunkZ}`, {
          chunkX,
          chunkZ,
          value,
          prospected: field.source === 'prospected',
        })
      }
    }
  }

  const areas = new Map<string, { x: number; z: number }>()
  for (const chunk of chunks.values()) {
    const x = floorDiv(chunk.chunkX, range) * range
    const z = floorDiv(chunk.chunkZ, range) * range
    areas.set(`${x},${z}`, { x, z })
  }

  const recommendations: RigRecommendation[] = []
  for (const area of areas.values()) {
    let activeChunks = 0
    let prospectedChunks = 0
    let totalYield = 0
    let baseOutputPerCycle = 0
    const matchingChunks: FluidChunk[] = []
    for (let dx = 0; dx < range; dx++) {
      for (let dz = 0; dz < range; dz++) {
        const chunk = chunks.get(`${area.x + dx},${area.z + dz}`)
        if (!chunk) continue
        matchingChunks.push(chunk)
        activeChunks++
        if (chunk.prospected) prospectedChunks++
        totalYield += chunk.value
        baseOutputPerCycle += Math.floor(chunk.value / 2)
      }
    }

    // The controller only selects the fluid; it does not add extra output.
    // Any matching chunk in this snapped area works. Prefer a corner so the
    // suggested placement makes the area's direction obvious on the map.
    const cornerKeys = [
      `${area.x},${area.z}`,
      `${area.x + range - 1},${area.z}`,
      `${area.x},${area.z + range - 1}`,
      `${area.x + range - 1},${area.z + range - 1}`,
    ]
    const controller =
      cornerKeys
        .map((key) => chunks.get(key))
        .find((chunk) => chunk !== undefined) ?? matchingChunks[0]
    if (!controller) continue
    recommendations.push({
      key: `${area.x},${area.z},${range}`,
      range,
      areaChunkX: area.x,
      areaChunkZ: area.z,
      controllerChunkX: controller.chunkX,
      controllerChunkZ: controller.chunkZ,
      x: controller.chunkX * 16 + 8,
      z: controller.chunkZ * 16 + 8,
      activeChunks,
      prospectedChunks,
      totalYield,
      baseOutputPerCycle,
      estimatedLitersPerSecond: baseOutputPerCycle * 2.5,
    })
  }

  return recommendations
    .sort(
      (a, b) =>
        b.baseOutputPerCycle - a.baseOutputPerCycle ||
        b.totalYield - a.totalYield ||
        b.activeChunks - a.activeChunks ||
        a.areaChunkZ - b.areaChunkZ ||
        a.areaChunkX - b.areaChunkX
    )
    .slice(0, MAX_RECOMMENDATIONS)
}
