import type { FluidsProspectingField } from './api/fluidsProspecting'
import { fluidDisplay } from './fluidDisplay'

export const EMPTY_FLUID_GROUP = '__empty__'

export interface FluidGroup {
  key: string
  fluid: string
  name: string
  color: string
  fields: FluidsProspectingField[]
  predicted: number
  prospected: number
  empty: boolean
}

export interface FluidFieldYieldStats {
  chunks: number
  minimum: number
  maximum: number
  average: number
  total: number
}

export function fluidFieldYieldStats(
  field: FluidsProspectingField,
  minimumYield: number
): FluidFieldYieldStats | null {
  const cutoff = Math.max(0, Math.floor(minimumYield))
  const values = field.yields.filter((value) => value > 0 && value >= cutoff)
  if (values.length === 0) return null
  const total = values.reduce((sum, value) => sum + value, 0)
  return {
    chunks: values.length,
    minimum: Math.min(...values),
    maximum: Math.max(...values),
    average: Math.round(total / values.length),
    total,
  }
}

/** Hide sub-threshold chunks and fields before map and rig calculations. */
export function applyMinimumFluidYield(
  fields: FluidsProspectingField[],
  minimumYield: number
): FluidsProspectingField[] {
  const cutoff = Math.max(0, Math.floor(minimumYield))
  if (cutoff <= 0) return fields
  const result: FluidsProspectingField[] = []
  for (const field of fields) {
    if (field.empty) continue
    const yields = field.yields.map((value) => (value >= cutoff ? value : 0))
    const positive = yields.filter((value) => value > 0)
    if (positive.length === 0) continue
    result.push({
      ...field,
      yields,
      min_yield: Math.min(...positive),
      max_yield: Math.max(...positive),
    })
  }
  return result
}

export function fluidGroupKey(field: FluidsProspectingField): string {
  return field.empty ? EMPTY_FLUID_GROUP : field.fluid
}

/** Group map fields by displayed fluid, with every empty deposit in one group. */
export function groupFieldsByFluid(
  fields: FluidsProspectingField[]
): FluidGroup[] {
  const groups = new Map<string, FluidGroup>()
  for (const field of fields) {
    const key = fluidGroupKey(field)
    let group = groups.get(key)
    if (!group) {
      const display = field.empty
        ? { name: 'Empty', color: '#a3a3a3' }
        : fluidDisplay(field.fluid)
      group = {
        key,
        fluid: field.fluid,
        name: display.name,
        color: display.color,
        fields: [],
        predicted: 0,
        prospected: 0,
        empty: field.empty,
      }
      groups.set(key, group)
    }
    group.fields.push(field)
    if (field.source === 'prospected') group.prospected++
    else group.predicted++
  }
  return [...groups.values()].sort((a, b) => {
    if (a.empty !== b.empty) return a.empty ? 1 : -1
    return a.name.localeCompare(b.name)
  })
}
