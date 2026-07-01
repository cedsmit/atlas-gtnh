import { describe, expect, it } from 'vitest'

import { BlockRenderRegistry } from './blockRenderRegistry'

describe('BlockRenderRegistry wildcard rules', () => {
  const load = (blocks: Record<string, { category: string }>) => {
    const reg = new BlockRenderRegistry()
    reg.loadJson({ format: 1, source: 'test.json', blocks } as never)
    return reg
  }

  it('matches a prefix*suffix pattern', () => {
    const reg = load({ 'harvestcraft:pam*Crop': { category: 'overlay' } })
    reg.resolveNames({ 100: 'harvestcraft:pamartichokeCrop' })
    expect(reg.lookup(100).category).toBe('overlay')
  })

  it('does not match when suffix is absent', () => {
    const reg = load({ 'harvestcraft:pam*Crop': { category: 'overlay' } })
    reg.resolveNames({ 100: 'harvestcraft:pamappleSapling' })
    expect(reg.lookup(100).category).toBe('solid') // default
  })

  it('requires the name to be at least prefix+suffix long', () => {
    // "a*a" must not match the 1-char overlap name "a"... i.e. "x:a" vs "x:a*a"
    const reg = load({ 'x:a*a': { category: 'overlay' } })
    reg.resolveNames({ 100: 'x:a' })
    expect(reg.lookup(100).category).toBe('solid')
  })

  it('exact entries win over wildcard patterns', () => {
    const reg = load({
      'harvestcraft:pam*Crop': { category: 'overlay' },
      'harvestcraft:pambeanCrop': { category: 'ignore' },
    })
    reg.resolveNames({
      100: 'harvestcraft:pambeanCrop',
      101: 'harvestcraft:pambeetCrop',
    })
    expect(reg.lookup(100).category).toBe('ignore')
    expect(reg.lookup(101).category).toBe('overlay')
  })
})
