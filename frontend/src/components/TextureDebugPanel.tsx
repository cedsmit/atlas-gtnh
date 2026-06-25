import { useEffect, useMemo, useState } from 'react'

import { API_BASE } from '../lib/api'
import { type BlockRenderRegistry } from '../lib/blockRenderRegistry'
import { getTexture, onTextureLoad } from '../lib/textureLoader'
import {
  textureDebugStore,
  type DebugBlockView,
  type RenderTotals,
  type TexDebugStatus,
  type TintType,
} from '../lib/textureDebugStore'

interface Props {
  worldPath?: string
  registry?: BlockRenderRegistry
  onClose: () => void
}

type StatusFilter = 'all' | TexDebugStatus | 'water'

const TINT_LABEL: Record<TintType, string> = {
  grass:   'grass',
  foliage: 'foliage',
  water:   'water',
  none:    '',
}

const TINT_CLASS: Record<TintType, string> = {
  grass:   'bg-green-700 text-green-200',
  foliage: 'bg-teal-800 text-teal-200',
  water:   'bg-blue-800 text-blue-200',
  none:    '',
}

const STATUS_LABEL: Record<TexDebugStatus, string> = {
  loaded: 'loaded',
  missing: 'failed',
  pending: 'pending',
  'no-mapping': 'no mapping',
}

const STATUS_CLASS: Record<TexDebugStatus, string> = {
  loaded: 'text-emerald-400',
  missing: 'text-red-400',
  pending: 'text-zinc-500',
  'no-mapping': 'text-amber-400',
}

export function TextureDebugPanel({ worldPath, registry, onClose }: Props) {
  const [tick, setTick] = useState(0)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [tracing, setTracing] = useState(false)

  // Re-render when debug store or texture states change
  useEffect(() => {
    const unsubStore = textureDebugStore.subscribe(() => setTick((t) => t + 1))
    const unsubTex = onTextureLoad(() => setTick((t) => t + 1))
    return () => {
      unsubStore()
      unsubTex()
    }
  }, [])

  const allBlocks    = useMemo(() => textureDebugStore.getAll(), [tick])
  const stats        = useMemo(() => textureDebugStore.getStats(), [tick])
  const renderTotals = useMemo<RenderTotals>(() => textureDebugStore.getRenderTotals(), [tick])

  const filtered = useMemo(() => {
    let list = allBlocks
    if (statusFilter === 'water') {
      list = list.filter((b) => b.tintType === 'water')
    } else if (statusFilter !== 'all') {
      list = list.filter((b) => b.texStatus === statusFilter)
    }
    if (query) {
      const q = query.toLowerCase()
      list = list.filter(
        (b) =>
          String(b.id).includes(q) ||
          (b.name ?? '').toLowerCase().includes(q) ||
          (b.texKey ?? '').toLowerCase().includes(q),
      )
    }
    return list.sort((a, b) => b.occurrences - a.occurrences)
  }, [allBlocks, query, statusFilter])

  // Console dump on demand
  function dumpToConsole() {
    console.group('[atlas:debug] Block texture status dump')
    for (const b of allBlocks.sort((a, c) => a.id - c.id)) {
      const status = b.texStatus
      const label = STATUS_LABEL[status]
      const marker = status === 'loaded' ? '✓' : status === 'missing' ? '✗' : status === 'pending' ? '…' : '?'
      console.log(
        `%c${marker}%c [${b.id}] ${b.name ?? '?'} | tex=${b.texKey ?? 'none'} | ${label} | ×${b.occurrences}`,
        status === 'loaded' ? 'color:#34d399' : status === 'missing' ? 'color:#f87171' : 'color:#9ca3af',
        'color:inherit',
      )
    }
    console.groupEnd()
  }

  async function traceResolution() {
    if (!worldPath || tracing) return
    setTracing(true)
    try {
      const url = `${API_BASE}/worlds/debug-texture-resolution?world_path=${encodeURIComponent(worldPath)}`
      const res = await fetch(url)
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = await res.json() as Record<string, any>

      console.group('[atlas:trace] Texture resolution chain')
      console.log('mc_dir:', data.mc_dir ?? 'NOT FOUND')
      console.log(`texture_colors: ${data.texture_color_count} keys scanned`)
      console.log('Vanilla keys in scanned colors:', data.vanilla_keys_in_colors)

      console.group('JARs found:')
      for (const jar of (data.jars ?? [])) {
        console.log(`  ${jar.status === 'cached' ? '📦' : jar.status === 'scanned' ? '🔍' : '❌'} ${jar.jar} — ${jar.keys} keys (${jar.status})`)
      }
      console.groupEnd()

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const blocks: any[] = data.blocks ?? []
      const noMapping = blocks.filter((b) => b.source === 'none')
      const fromJar   = blocks.filter((b) => b.source === 'jar')
      const fallback  = blocks.filter((b) => b.source === 'fallback')

      console.group(`Block resolution: ${fromJar.length} from JAR, ${fallback.length} from fallback table, ${noMapping.length} unresolved`)
      for (const b of noMapping) {
        console.log(`%c? [${b.id}] ${b.name} — no key (neither JAR nor fallback table)`, 'color:#f59e0b')
      }
      for (const b of fallback) {
        console.log(`%c~ [${b.id}] ${b.name} → ${b.fallback_key} (fallback — image may 404 if JAR not found)`, 'color:#a78bfa')
      }
      console.groupEnd()
      console.groupEnd()
    } catch (err) {
      console.error('[atlas:trace] Failed:', err)
    } finally {
      setTracing(false)
    }
  }

  return (
    <div className="flex h-full w-[480px] shrink-0 flex-col border-l border-zinc-800 bg-zinc-950">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2">
        <span className="text-sm font-semibold text-zinc-200">Texture Debug</span>
        <div className="flex items-center gap-2">
          <button
            onClick={dumpToConsole}
            className="rounded bg-zinc-800 px-2 py-0.5 font-mono text-[10px] text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
            title="Dump full block list to browser console"
          >
            console.log
          </button>
          {worldPath && (
            <button
              onClick={() => void traceResolution()}
              disabled={tracing}
              className="rounded bg-zinc-800 px-2 py-0.5 font-mono text-[10px] text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200 disabled:opacity-40"
              title="Trace texture resolution chain to console"
            >
              {tracing ? '…trace' : 'trace'}
            </button>
          )}
          <button
            onClick={onClose}
            className="text-zinc-500 transition-colors hover:text-zinc-200"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
      </div>

      {/* ── Render proof banner ── */}
      <RenderProof rt={renderTotals} />

      {/* Block stats bar */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 border-b border-zinc-800 px-4 py-2 font-mono text-xs">
        <span className="text-emerald-400">{stats.loaded} loaded</span>
        <span className="text-red-400">{stats.missing} failed</span>
        <span className="text-zinc-500">{stats.pending} pending</span>
        <span className="text-amber-400">{stats.noMapping} no-mapping</span>
        <span className="ml-auto text-zinc-600">{stats.total} unique blocks</span>
      </div>

      {/* Filters */}
      <div className="flex gap-2 border-b border-zinc-800 px-3 py-2">
        <input
          type="text"
          placeholder="filter by name, id, or texture key…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="min-w-0 flex-1 rounded bg-zinc-900 px-2 py-1 font-mono text-xs text-zinc-300 outline-none ring-1 ring-zinc-700 focus:ring-zinc-500"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          className="rounded bg-zinc-900 px-2 py-1 font-mono text-xs text-zinc-300 ring-1 ring-zinc-700 focus:outline-none focus:ring-zinc-500"
        >
          <option value="all">All</option>
          <option value="loaded">Loaded</option>
          <option value="pending">Pending</option>
          <option value="missing">Failed</option>
          <option value="no-mapping">No Mapping</option>
          <option value="water">Water</option>
        </select>
      </div>

      {/* Column headers */}
      <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-1 font-mono text-[10px] text-zinc-600">
        <span className="w-8 shrink-0">tex</span>
        <span className="w-8 shrink-0">id</span>
        <span className="flex-1">name</span>
        <span className="w-16 shrink-0">tint</span>
        <span className="w-16 shrink-0">status</span>
        <span className="w-8 shrink-0 text-right">×</span>
      </div>

      {/* Block list */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-zinc-600">
            {allBlocks.length === 0
              ? 'No blocks recorded yet — open the map to populate.'
              : `No blocks match current filter.`}
          </p>
        ) : (
          filtered.map((b) => <DebugRow key={b.id} block={b} registry={registry} />)
        )}
      </div>
    </div>
  )
}

// ── Render proof banner ────────────────────────────────────────────────────
function RenderProof({ rt }: { rt: RenderTotals }) {
  const total = rt.drawImage + rt.fillRect
  const pct   = total > 0 ? Math.round((rt.drawImage / total) * 100) : 0

  if (rt.chunks === 0) {
    return (
      <div className="border-b border-zinc-800 px-4 py-2 font-mono text-xs text-zinc-600">
        No chunks rendered yet — scroll the map to load tiles.
      </div>
    )
  }

  const isWorking = rt.drawImage > 0

  return (
    <div
      className={`border-b px-4 py-2 font-mono text-xs ${
        isWorking ? 'border-emerald-900 bg-emerald-950/40' : 'border-red-900 bg-red-950/40'
      }`}
    >
      {/* Headline */}
      <div className={`font-semibold ${isWorking ? 'text-emerald-400' : 'text-red-400'}`}>
        {isWorking
          ? `✓ Textures rendering — ${pct}% of blocks use drawImage`
          : '✗ drawImage = 0 — renderer is using flat colors only'}
      </div>

      {/* Counter row */}
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px]">
        <span className="text-emerald-400">drawImage: {rt.drawImage.toLocaleString()}</span>
        <span className="text-zinc-400">fillRect: {rt.fillRect.toLocaleString()}</span>
        <span className="text-amber-400">no-key: {rt.missingTexKey.toLocaleString()}</span>
        <span className="text-red-400">failed-load: {rt.failedTexLoad.toLocaleString()}</span>
        <span className="ml-auto text-zinc-600">{rt.chunks} chunks</span>
      </div>

      {/* Progress bar — texture coverage */}
      {total > 0 && (
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-zinc-800">
          <div
            className={`h-full rounded-full transition-[width] duration-300 ${
              isWorking ? 'bg-emerald-500' : 'bg-red-600'
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}

      {/* Diagnostic hint when drawImage === 0 */}
      {!isWorking && total > 0 && (
        <div className="mt-1 text-[10px] text-zinc-500">
          {rt.missingTexKey > 0 && rt.failedTexLoad === 0
            ? `All ${rt.missingTexKey.toLocaleString()} blocks have no texture key — check that textureKeys prop reaches WorldMap.`
            : rt.failedTexLoad > 0 && rt.missingTexKey === 0
              ? `${rt.failedTexLoad.toLocaleString()} textures have keys but images not loaded — preload may not have finished or backend is returning 404.`
              : `missingKey=${rt.missingTexKey} failedLoad=${rt.failedTexLoad} — check console for chunk render logs.`}
        </div>
      )}
    </div>
  )
}

function DebugRow({ block: b, registry }: { block: DebugBlockView; registry?: BlockRenderRegistry }) {
  const [copied, setCopied] = useState(false)
  const texImg    = b.texKey ? getTexture(b.texKey) : null
  const status    = b.texStatus
  const tintLabel = TINT_LABEL[b.tintType]
  const tintClass = TINT_CLASS[b.tintType]
  const regDef    = registry?.lookup(b.id)

  const renderMode =
    status === 'loaded' && b.tintType !== 'none' && b.tintType !== 'water'
      ? 'texture+tint'
      : status === 'loaded'
        ? 'texture'
        : b.tintType !== 'none'
          ? b.tintType === 'water' ? 'water depth' : 'biome color'
          : STATUS_LABEL[status]

  // Build suggested JSON entry for this block
  const blockName = b.name ?? `block:${b.id}`
  const suggestedEntry = buildSuggestedJson(b, regDef?.category)

  async function copyJson() {
    await navigator.clipboard.writeText(suggestedEntry)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const isFallback = status === 'no-mapping' || status === 'missing'

  return (
    <div className="flex flex-col border-b border-zinc-900 px-3 py-1.5">
      <div className="flex items-center gap-2">
        {/* Texture thumbnail */}
        <div className="h-8 w-8 shrink-0 overflow-hidden rounded border border-zinc-700 bg-zinc-800">
          {texImg ? (
            <img
              src={texImg.src}
              alt=""
              className="h-full w-full"
              style={{ imageRendering: 'pixelated' }}
            />
          ) : (
            <div
              className={`flex h-full w-full items-center justify-center font-mono text-[9px] ${
                status === 'pending'    ? 'text-zinc-600'  :
                status === 'missing'   ? 'text-red-600'   :
                status === 'no-mapping'? 'text-amber-700' : 'text-zinc-700'
              }`}
            >
              {status === 'pending' ? '…' : status === 'missing' ? '✗' : status === 'no-mapping' ? '?' : ''}
            </div>
          )}
        </div>

        {/* ID */}
        <span className="w-8 shrink-0 font-mono text-[11px] text-zinc-500">{b.id}</span>

        {/* Name + render mode */}
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-mono text-[11px] text-zinc-300">{blockName}</span>
          <span className="truncate font-mono text-[10px] text-zinc-500">{renderMode}</span>
        </div>

        {/* Tint badge */}
        <span className="w-16 shrink-0">
          {tintLabel && (
            <span className={`rounded px-1 py-0.5 font-mono text-[9px] ${tintClass}`}>
              {tintLabel}
            </span>
          )}
        </span>

        {/* Status */}
        <span className={`w-16 shrink-0 font-mono text-[10px] ${STATUS_CLASS[status]}`}>
          {STATUS_LABEL[status]}
        </span>

        {/* Occurrence count */}
        <span className="w-8 shrink-0 text-right font-mono text-[10px] text-zinc-600">
          {b.occurrences.toLocaleString()}
        </span>
      </div>

      {/* Registry + suggested JSON (expanded for fallback blocks) */}
      {regDef && (
        <div className="mt-1 flex items-start gap-2 pl-10">
          <div className="min-w-0 flex-1">
            <span className="font-mono text-[10px] text-zinc-600">
              {regDef.category}
              {regDef.tint         ? ` · tint:${regDef.tint}`           : ''}
              {regDef.mapVisibility && regDef.mapVisibility !== 'clean'
                                   ? ` · vis:${regDef.mapVisibility}`   : ''}
              {regDef.resolverSource !== 'default'
                                   ? ` · from:${regDef.resolverSource}` : ''}
            </span>
            {isFallback && (
              <div className="mt-0.5 truncate rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[9px] text-zinc-500">
                {suggestedEntry}
              </div>
            )}
          </div>
          {isFallback && (
            <button
              onClick={() => void copyJson()}
              className="shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[9px] text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
              title="Copy suggested JSON rule to clipboard"
            >
              {copied ? 'copied!' : 'copy JSON'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function buildSuggestedJson(b: DebugBlockView, knownCategory?: string): string {
  const name = b.name ?? `block:${b.id}`
  const cat  = knownCategory ?? 'solid'
  const tint = b.tintType !== 'none' && b.tintType !== 'water' ? `, "tint": "${b.tintType}"` : ''
  return `"${name}": { "category": "${cat}"${tint} }`
}
