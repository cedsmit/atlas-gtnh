import type { BedrockFluidField } from './api/bedrockFluids'
import { fluidDisplay } from './fluidDisplay'

export const EMPTY_FLUID_GROUP = '__empty__'

export interface FluidGroup {
  key: string
  fluid: string
  name: string
  color: string
  fields: BedrockFluidField[]
  predicted: number
  prospected: number
  empty: boolean
}

export function fluidGroupKey(field: BedrockFluidField): string {
  return field.empty ? EMPTY_FLUID_GROUP : field.fluid
}

/** Group map fields by displayed fluid, with every empty deposit in one group. */
export function groupFieldsByFluid(fields: BedrockFluidField[]): FluidGroup[] {
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
