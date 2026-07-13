import { Palette, X } from 'lucide-react'
import { useMemo, useState } from 'react'

import type { BlockColorMap } from '../blocks/api/blockColors'
import {
  biomeTints,
  blockColorRGB,
  FOLIAGE_TINTED_IDS,
  GRASS_TINTED_IDS,
  hardcodedBlockColor,
} from '../blocks/blockColors'

interface Props {
  blockColors: BlockColorMap
  blockNames: Record<number, string>
  /** When provided, used to definitively classify texture vs built-in/fallback. */
  textureKeys?: Record<number, string>
  onClose: () => void
}

type Source =
  | 'texture'
  | 'biome-grass'
  | 'biome-foliage'
  | 'built-in'
  | 'fallback'

interface Entry {
  id: number
  name: string
  rgb: readonly [number, number, number]
  source: Source
}

const SOURCE_ORDER: Record<Source, number> = {
  texture: 0,
  'biome-grass': 1,
  'biome-foliage': 1,
  'built-in': 2,
  fallback: 3,
}

const SOURCE_LABEL: Record<Source, string> = {
  texture: 'texture',
  'biome-grass': 'biome grass',
  'biome-foliage': 'biome foliage',
  'built-in': 'built-in',
  fallback: 'fallback',
}

const SOURCE_CLASS: Record<Source, string> = {
  texture: 'text-emerald-400',
  'biome-grass': 'text-sky-400',
  'biome-foliage': 'text-sky-400',
  'built-in': 'text-violet-400',
  fallback: 'text-amber-400',
}

export function InspectPanel({
  blockColors,
  blockNames,
  textureKeys,
  onClose,
}: Props) {
  const [query, setQuery] = useState('')

  // Use Plains (biome 1) as the representative biome for biome-tinted preview
  const plainsGrass = biomeTints(1).grass
  const plainsFoliage = biomeTints(1).foliage

  const allEntries = useMemo<Entry[]>(() => {
    const entries: Entry[] = Object.entries(blockNames).map(([idStr, name]) => {
      const id = Number(idStr)
      let rgb: readonly [number, number, number]
      let source: Source

      if (GRASS_TINTED_IDS.has(id)) {
        rgb = plainsGrass
        source = 'biome-grass'
      } else if (FOLIAGE_TINTED_IDS.has(id)) {
        rgb = plainsFoliage
        source = 'biome-foliage'
      } else if (textureKeys ? !!textureKeys[id] : !!blockColors[id]) {
        // When textureKeys is available: 'texture' only for blocks with a confirmed PNG key.
        // Without textureKeys (still loading): fall back to checking blockColors.
        rgb =
          (blockColors[id] as readonly [number, number, number] | undefined) ??
          blockColorRGB(id, 0)
        source = 'texture'
      } else {
        const hardcoded = hardcodedBlockColor(id)
        if (hardcoded) {
          rgb = hardcoded
          source = 'built-in'
        } else if (blockColors[id]) {
          // Has a color from vanilla fallback table but no texture PNG key
          rgb = blockColors[id] as readonly [number, number, number]
          source = 'built-in'
        } else {
          rgb = blockColorRGB(id, 0)
          source = 'fallback'
        }
      }

      return { id, name, rgb, source }
    })

    entries.sort(
      (a, b) => SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source] || a.id - b.id
    )
    return entries
  }, [blockColors, blockNames, textureKeys, plainsGrass, plainsFoliage])

  const filtered = useMemo(() => {
    if (!query) return allEntries
    const q = query.toLowerCase()
    return allEntries.filter(
      (e) => e.name.toLowerCase().includes(q) || String(e.id).includes(q)
    )
  }, [allEntries, query])

  const textureCount = allEntries.filter((e) => e.source === 'texture').length
  const biomeCount = allEntries.filter(
    (e) => e.source === 'biome-grass' || e.source === 'biome-foliage'
  ).length
  const builtInCount = allEntries.filter((e) => e.source === 'built-in').length
  const fallbackCount = allEntries.filter((e) => e.source === 'fallback').length

  return (
    <div className="flex h-full w-96 shrink-0 flex-col border-l border-zinc-800 bg-zinc-950">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2">
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-zinc-200">
          <Palette className="h-4 w-4" aria-hidden />
          Block Colors
        </span>
        <button
          onClick={onClose}
          className="text-zinc-500 transition-colors hover:text-zinc-200"
          aria-label="Close"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>

      {/* Stats */}
      <div className="flex gap-3 border-b border-zinc-800 px-4 py-2 font-mono text-xs">
        <span className="text-emerald-400">{textureCount} texture</span>
        <span className="text-sky-400">{biomeCount} biome</span>
        <span className="text-violet-400">{builtInCount} built-in</span>
        <span className="text-amber-400">{fallbackCount} fallback</span>
        <span className="ml-auto text-zinc-600">{allEntries.length} total</span>
      </div>

      {/* Search */}
      <div className="border-b border-zinc-800 px-3 py-2">
        <input
          type="text"
          placeholder="filter by name or id…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full rounded bg-zinc-900 px-2 py-1 font-mono text-xs text-zinc-300 outline-none ring-1 ring-zinc-700 focus:ring-zinc-500"
        />
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {filtered.map(({ id, name, rgb, source }) => {
          const hex =
            '#' +
            Array.from(rgb)
              .map((v) => v.toString(16).padStart(2, '0'))
              .join('')

          return (
            <div
              key={id}
              className="flex items-center gap-2 border-b border-zinc-900 px-3 py-1.5"
            >
              <div
                className="h-5 w-5 shrink-0 rounded-sm border border-zinc-700"
                style={{ background: hex }}
              />
              <span className="w-10 shrink-0 font-mono text-[11px] text-zinc-500">
                {id}
              </span>
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-zinc-300">
                {name}
              </span>
              <span className="font-mono text-[11px] text-zinc-600">{hex}</span>
              <span className={`shrink-0 text-[10px] ${SOURCE_CLASS[source]}`}>
                {SOURCE_LABEL[source]}
              </span>
            </div>
          )
        })}

        {filtered.length === 0 && (
          <p className="px-4 py-6 text-center text-xs text-zinc-600">
            No blocks match &ldquo;{query}&rdquo;
          </p>
        )}
      </div>
    </div>
  )
}
