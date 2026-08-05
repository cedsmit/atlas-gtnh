import { describe, expect, it } from 'vitest'

import { fluidDisplay } from './fluidDisplay'

describe('fluidDisplay', () => {
  it('uses GTNH names and stable colours for known fluids', () => {
    expect(fluidDisplay('gas_natural_gas')).toEqual({
      name: 'Natural Gas',
      color: '#00ffff',
    })
    expect(fluidDisplay('oil').name).toBe('Oil')
    expect(fluidDisplay('liquid_medium_oil').name).toBe('Raw Oil')
    expect(fluidDisplay('molten.iron')).toEqual({
      name: 'Molten Iron',
      color: '#8b8878',
    })
  })

  it('turns unknown registry keys into readable names', () => {
    const first = fluidDisplay('liquid_exotic_fuel')
    const second = fluidDisplay('liquid_exotic_fuel')
    expect(first.name).toBe('Exotic Fuel')
    expect(first.color).toBe(second.color)
  })
})
