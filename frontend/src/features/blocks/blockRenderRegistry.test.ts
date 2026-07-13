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

describe('user overrides (Stage 2.3)', () => {
  it('a later loadJson (user override) wins over an earlier bundled rule', () => {
    const reg = new BlockRenderRegistry()
    // bundled rule, then the user override loaded last (as createResolvedRegistry does)
    reg.loadJson({
      source: 'chisel.json',
      blocks: { 'mod:x': { category: 'solid' } },
    } as never)
    reg.loadJson({
      source: 'user-overrides',
      blocks: { 'mod:x': { category: 'transparent' } },
    } as never)
    reg.resolveNames({ 100: 'mod:x' })
    expect(reg.lookup(100).category).toBe('transparent')
    expect(reg.lookup(100).resolverSource).toBe('user-overrides')
  })

  it('a user override beats a built-in vanilla definition', () => {
    const reg = new BlockRenderRegistry()
    // vanilla id 2 (grass) is a built-in 'solid' + grass tint; override to ignore
    reg.loadJson({
      source: 'user-overrides',
      blocks: { 'minecraft:grass': { category: 'ignore' } },
    } as never)
    reg.resolveNames({ 2: 'minecraft:grass' })
    expect(reg.lookup(2).category).toBe('ignore')
  })
})

describe('hiddenTaggedIds (Stage 3.1 solid layer hiding)', () => {
  it('collects tagged blocks of any category, not just overlays', () => {
    const reg = new BlockRenderRegistry()
    reg.loadJson({
      source: 'test.json',
      blocks: {
        'mod:solidPipe': { category: 'solid', blockTags: ['pipe'] },
        'mod:overlayCable': { category: 'overlay', blockTags: ['cable'] },
        'mod:machine': { category: 'solid', blockTags: ['machine'] },
        'mod:plainStone': { category: 'solid' },
      },
    } as never)
    reg.resolveNames({
      10: 'mod:solidPipe',
      11: 'mod:overlayCable',
      12: 'mod:machine',
      13: 'mod:plainStone',
    })
    const hidden = reg.hiddenTaggedIds(new Set(['pipe', 'cable']))
    expect(hidden).toContain(10) // solid pipe — the Stage 3.1 fix
    expect(hidden).toContain(11) // overlay cable
    expect(hidden).not.toContain(12) // machine tag not hidden
    expect(hidden).not.toContain(13) // untagged
  })
})

describe('per-metadata classification', () => {
  it('a "name:meta" rule overrides only that meta; other metas use the id def', () => {
    const reg = new BlockRenderRegistry()
    reg.loadJson({
      source: 'test.json',
      blocks: {
        // Base block has no id-level rule (defaults to solid); only meta 7 is a light.
        'Thaumcraft:blockMetalDevice:7': {
          category: 'solid',
          blockTags: ['torch'],
        },
      },
    } as never)
    reg.resolveNames({ 476: 'Thaumcraft:blockMetalDevice' })
    // meta 7 → the light rule; meta 3 (alembic) and no-meta → id-level default.
    expect(reg.lookup(476, 7).blockTags).toEqual(['torch'])
    expect(reg.lookup(476, 3).blockTags).toBeUndefined()
    expect(reg.lookup(476).blockTags).toBeUndefined()
  })

  it('does not treat a normal colon-name as a meta rule', () => {
    const reg = new BlockRenderRegistry()
    reg.loadJson({
      source: 'test.json',
      blocks: { 'BuildCraft|Transport:pipeBlock': { category: 'overlay' } },
    } as never)
    reg.resolveNames({ 200: 'BuildCraft|Transport:pipeBlock' })
    expect(reg.lookup(200).category).toBe('overlay') // resolved as a full name
  })
})
