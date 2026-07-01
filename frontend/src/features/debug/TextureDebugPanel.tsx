import { Bug, Check, ChevronDown, ChevronRight, Copy, Loader2, Search, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { API_BASE } from '../../shared/api'
import { type BlockRenderRegistry } from '../blocks/blockRenderRegistry'
import { getTexture, onTextureLoad } from '../textures/textureLoader'
import {
  textureDebugStore,
  type DebugBlockView,
  type RenderTotals,
  type TexDebugStatus,
  type TintType,
} from '../textures/textureDebugStore'

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
  'no-mapping': 'no key',
}

const STATUS_CLASS: Record<TexDebugStatus, string> = {
  loaded: 'text-emerald-400',
  missing: 'text-red-400',
  pending: 'text-zinc-500',
  'no-mapping': 'text-amber-400',
}

interface PipelineCategory {
  category: string
  count: number
  examples: string[]
}

interface PipelineReport {
  total: number
  pipeline_resolved: number
  pipeline_unresolved: number
  override_resolved: number
  forge_dump_resolved: number
  forge_dump_ambiguous: number
  forge_dump_loaded: boolean
  forge_dump_path: string | null
  forge_dump_block_count: number
  modern_resolved: number
  legacy_resolved: number
  legacy_high: number
  legacy_medium: number
  legacy_low: number
  legacy_ambiguous: number
  blockstate_count: number
  model_count: number
  texture_color_count: number
  categories: Record<string, number>
  examples: Record<string, string[]>
  legacy_examples: Record<string, string[]>
  block_methods: Record<string, string>
}

const CATEGORY_LABELS: Record<string, string> = {
  no_blockstate:               'No blockstate (legacy also failed)',
  forge_builtin_renderer:      'Forge builtin renderer',
  no_variant_for_meta:         'No variant for meta',
  model_not_found:             'Model file not found',
  texture_variable_unresolved: 'Texture var unresolved',
  texture_not_in_db:           'Texture PNG not scanned',
  bad_blockstate_format:       'Bad blockstate format',
}

const METHOD_LABEL: Record<string, string> = {
  override:                    'override',
  forge_dump:                  'forge ✓',
  forge_dump_ambiguous:        'forge ~',
  modern:                      'modern',
  legacy_high:                 'legacy ✓✓',
  legacy_medium:               'legacy ✓',
  legacy_low:                  'legacy ?',
  legacy_high_ambiguous:       'legacy ~~',
  legacy_medium_ambiguous:     'legacy ~?',
  legacy_low_ambiguous:        'legacy ~',
  none:                        'fallback',
}

const METHOD_CLASS: Record<string, string> = {
  override:                    'bg-violet-900 text-violet-300',
  forge_dump:                  'bg-sky-900 text-sky-300',
  forge_dump_ambiguous:        'bg-sky-900 text-orange-300',
  modern:                      'bg-blue-900 text-blue-300',
  legacy_high:                 'bg-teal-900 text-teal-300',
  legacy_medium:               'bg-emerald-900 text-emerald-300',
  legacy_low:                  'bg-amber-900 text-amber-300',
  legacy_high_ambiguous:       'bg-teal-900 text-orange-300',
  legacy_medium_ambiguous:     'bg-emerald-900 text-orange-300',
  legacy_low_ambiguous:        'bg-orange-950 text-orange-300',
  none:                        'bg-zinc-800 text-zinc-500',
}

export function TextureDebugPanel({ worldPath, registry, onClose }: Props) {
  const [tick, setTick] = useState(0)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [tracing, setTracing] = useState(false)
  const [pipelineReport, setPipelineReport] = useState<PipelineReport | null>(null)
  const [pipelineLoading, setPipelineLoading] = useState(false)
  const [showPipeline, setShowPipeline] = useState(false)

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

  async function fetchPipelineReport() {
    if (!worldPath || pipelineLoading) return
    setPipelineLoading(true)
    try {
      const url = `${API_BASE}/worlds/pipeline-report?world_path=${encodeURIComponent(worldPath)}`
      const res = await fetch(url)
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      const data = await res.json() as PipelineReport
      setPipelineReport(data)
      setShowPipeline(true)
    } catch (err) {
      console.error('[atlas:pipeline] Failed:', err)
    } finally {
      setPipelineLoading(false)
    }
  }

  return (
    <div className="flex h-full w-[480px] shrink-0 flex-col border-l border-zinc-800 bg-zinc-950">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2">
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-zinc-200">
          <Bug className="h-4 w-4" aria-hidden />
          Texture Debug
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={dumpToConsole}
            className="inline-flex items-center gap-1 rounded bg-zinc-800 px-2 py-0.5 font-mono text-[10px] text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
            title="Dump full block list to browser console"
          >
            <Bug className="h-3.5 w-3.5" aria-hidden />
            console.log
          </button>
          {worldPath && (
            <>
              <button
                onClick={() => void traceResolution()}
                disabled={tracing}
                className="inline-flex items-center gap-1 rounded bg-zinc-800 px-2 py-0.5 font-mono text-[10px] text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200 disabled:opacity-40"
                title="Trace texture resolution chain to console"
              >
                {tracing ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Search className="h-3.5 w-3.5" aria-hidden />}
                {tracing ? '…trace' : 'trace'}
              </button>
              <button
                onClick={() => void fetchPipelineReport()}
                disabled={pipelineLoading}
                className="inline-flex items-center gap-1 rounded bg-indigo-900 px-2 py-0.5 font-mono text-[10px] text-indigo-300 hover:bg-indigo-800 hover:text-indigo-100 disabled:opacity-40"
                title="Run blockstate resolution pipeline and show failure category report"
              >
                {pipelineLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Search className="h-3.5 w-3.5" aria-hidden />}
                {pipelineLoading ? '…pipeline' : 'pipeline'}
              </button>
            </>
          )}
          <button
            onClick={onClose}
            className="text-zinc-500 transition-colors hover:text-zinc-200"
            aria-label="Close"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>

      {/* ── Render proof banner ── */}
      <RenderProof rt={renderTotals} />

      {/* Block stats bar */}
      <div className="flex flex-col gap-1 border-b border-zinc-800 px-4 py-2 font-mono text-xs">
        {/* Unique-block row */}
        <div className="flex flex-wrap gap-x-3 gap-y-0.5">
          <span className="text-emerald-400">{stats.loaded} loaded</span>
          <span className="text-red-400">{stats.missing} failed</span>
          <span className="text-zinc-500">{stats.pending} pending</span>
          <span className="text-amber-400">{stats.noMapping} no-key</span>
          <span className="ml-auto text-zinc-600">{stats.total} unique block types</span>
        </div>
        {/* Occurrence-weighted row — only shown once chunks have rendered */}
        {(stats.occLoaded + stats.occMissing + stats.occNoMapping) > 0 && (
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px]">
            <span className="text-emerald-600">{stats.occLoaded.toLocaleString()} cols w/ tex</span>
            <span className="text-red-700">{stats.occMissing.toLocaleString()} cols failed</span>
            <span className="text-amber-700">{stats.occNoMapping.toLocaleString()} cols no-key</span>
            {(() => {
              const total = stats.occLoaded + stats.occMissing + stats.occNoMapping + stats.occPending
              const pct = total > 0 ? Math.round((stats.occLoaded / total) * 100) : 0
              return <span className="ml-auto text-zinc-600">{pct}% textured</span>
            })()}
          </div>
        )}
      </div>

      {/* Pipeline report — shown when fetched */}
      {showPipeline && pipelineReport && (
        <PipelineReportPanel
          report={pipelineReport}
          onClose={() => setShowPipeline(false)}
        />
      )}

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
          <option value="no-mapping">No Key</option>
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
          filtered.map((b) => (
            <DebugRow
              key={b.id}
              block={b}
              registry={registry}
              worldPath={worldPath}
              blockMethod={pipelineReport?.block_methods?.[String(b.id)]}
            />
          ))
        )}
      </div>
    </div>
  )
}

// ── Pipeline report panel ──────────────────────────────────────────────────
function PipelineReportPanel({ report, onClose }: { report: PipelineReport; onClose: () => void }) {
  const categories: PipelineCategory[] = Object.entries(report.categories).map(([cat, count]) => ({
    category: cat,
    count,
    examples: report.examples[cat] ?? [],
  }))

  const resolvedPct = report.total > 0
    ? Math.round((report.pipeline_resolved / report.total) * 100)
    : 0

  return (
    <div className="border-b border-indigo-900 bg-indigo-950/30 px-4 py-3 font-mono text-xs">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-semibold text-indigo-300">Pipeline Report</span>
        <button
          onClick={onClose}
          className="text-indigo-600 hover:text-indigo-300"
          aria-label="Close pipeline report"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>

      {/* Summary row */}
      <div className="mb-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px]">
        <span className="text-emerald-400">{report.pipeline_resolved} resolved</span>
        <span className="text-amber-400">{report.pipeline_unresolved} unresolved</span>
        <span className="ml-auto text-indigo-500">{resolvedPct}% of {report.total} blocks</span>
      </div>
      {/* Per-stage breakdown */}
      <div className="mb-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px]">
        {report.override_resolved > 0 && (
          <span className="text-violet-400">{report.override_resolved} override</span>
        )}
        {(report.forge_dump_resolved + report.forge_dump_ambiguous) > 0 && (
          <span className="text-sky-400">
            {report.forge_dump_resolved + report.forge_dump_ambiguous} forge dump
            {report.forge_dump_ambiguous > 0 && <span className="text-orange-400"> ({report.forge_dump_ambiguous} ~)</span>}
          </span>
        )}
        {report.modern_resolved > 0 && (
          <span className="text-blue-400">{report.modern_resolved} modern</span>
        )}
        {report.legacy_resolved > 0 && (
          <span className="text-teal-400">{report.legacy_resolved} legacy</span>
        )}
      </div>

      {/* Forge dump status */}
      <div className="mb-2 rounded border border-zinc-800 bg-zinc-900/60 px-2 py-1 text-[10px]">
        {report.forge_dump_loaded ? (
          <div className="flex flex-wrap gap-x-3 gap-y-0.5">
            <span className="inline-flex items-center gap-1 text-sky-400"><Check className="h-3.5 w-3.5" aria-hidden /> Forge dump loaded</span>
            <span className="text-zinc-500">{report.forge_dump_block_count.toLocaleString()} blocks</span>
            {report.forge_dump_path && (
              <span className="truncate text-zinc-600" title={report.forge_dump_path}>
                {report.forge_dump_path.split(/[/\\]/).pop()}
              </span>
            )}
          </div>
        ) : (
          <span className="inline-flex items-center gap-1 text-amber-500">
            <X className="h-3.5 w-3.5 shrink-0" aria-hidden /> Forge dump not loaded — build &amp; install AtlasDumper mod, run GTNH once
          </span>
        )}
      </div>
      {/* Legacy confidence breakdown */}
      {report.legacy_resolved > 0 && (
        <div className="mb-2 flex flex-wrap gap-x-3 gap-y-0.5 pl-2 text-[10px]">
          {report.legacy_high > 0 && (
            <span className="text-teal-300">{report.legacy_high} high</span>
          )}
          {report.legacy_medium > 0 && (
            <span className="text-emerald-300">{report.legacy_medium} medium</span>
          )}
          {report.legacy_low > 0 && (
            <span className="text-amber-300">{report.legacy_low} low</span>
          )}
          {report.legacy_ambiguous > 0 && (
            <span className="text-orange-400">{report.legacy_ambiguous} ambiguous</span>
          )}
        </div>
      )}
      <div className="mb-2 flex flex-wrap gap-x-4 gap-y-0.5 text-[10px] text-zinc-600">
        <span>{report.blockstate_count} blockstates</span>
        <span>{report.model_count} models</span>
        <span>{report.texture_color_count} textures</span>
      </div>

      {/* Progress bar */}
      <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-zinc-800">
        <div
          className="h-full rounded-full bg-emerald-600 transition-[width]"
          style={{ width: `${resolvedPct}%` }}
        />
      </div>

      {/* Failure category breakdown */}
      <div className="flex flex-col gap-1">
        {categories.map(({ category, count, examples }) => (
          <details key={category} className="group">
            <summary className="flex cursor-pointer items-baseline gap-2 list-none">
              <span className="text-amber-400 tabular-nums">{count.toLocaleString()}</span>
              <span className="text-zinc-300">{CATEGORY_LABELS[category] ?? category}</span>
              <ChevronRight className="ml-auto h-3.5 w-3.5 text-zinc-600 group-open:hidden" aria-hidden />
              <ChevronDown className="ml-auto hidden h-3.5 w-3.5 text-zinc-600 group-open:inline" aria-hidden />
            </summary>
            {examples.length > 0 && (
              <div className="ml-4 mt-1 flex flex-col gap-0.5">
                {examples.map((ex) => (
                  <span key={ex} className="truncate text-[10px] text-zinc-500">{ex}</span>
                ))}
              </div>
            )}
          </details>
        ))}
      </div>

      {/* Legacy resolution samples by confidence */}
      {report.legacy_examples && Object.keys(report.legacy_examples).length > 0 && (
        <div className="mt-2 flex flex-col gap-1 border-t border-indigo-900 pt-2">
          <span className="text-[10px] text-indigo-400">Legacy samples</span>
          {Object.entries(report.legacy_examples).map(([tag, exs]) => (
            <details key={tag} className="group">
              <summary className="flex cursor-pointer items-baseline gap-2 list-none">
                <span className={`rounded px-1 font-mono text-[9px] ${METHOD_CLASS[tag] ?? 'bg-zinc-800 text-zinc-400'}`}>
                  {METHOD_LABEL[tag] ?? tag}
                </span>
                <span className="text-[10px] text-zinc-500">{exs.length} shown</span>
                <ChevronRight className="ml-auto h-3.5 w-3.5 text-zinc-600 group-open:hidden" aria-hidden />
                <ChevronDown className="ml-auto hidden h-3.5 w-3.5 text-zinc-600 group-open:inline" aria-hidden />
              </summary>
              <div className="ml-4 mt-1 flex flex-col gap-0.5">
                {exs.map((ex) => (
                  <span key={ex} className="truncate text-[10px] text-zinc-500">{ex}</span>
                ))}
              </div>
            </details>
          ))}
        </div>
      )}
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
      <div className={`inline-flex items-center gap-1.5 font-semibold ${isWorking ? 'text-emerald-400' : 'text-red-400'}`}>
        {isWorking ? <Check className="h-3.5 w-3.5 shrink-0" aria-hidden /> : <X className="h-3.5 w-3.5 shrink-0" aria-hidden />}
        {isWorking
          ? `Textures rendering — ${pct}% of blocks use drawImage`
          : 'drawImage = 0 — renderer is using flat colors only'}
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

function DebugRow({
  block: b,
  registry,
  worldPath,
  blockMethod,
}: {
  block: DebugBlockView
  registry?: BlockRenderRegistry
  worldPath?: string
  blockMethod?: string
}) {
  const [copied, setCopied] = useState(false)
  const [tracing, setTracing] = useState(false)
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

  async function traceBlockPipeline() {
    if (!worldPath || !b.name || tracing) return
    setTracing(true)
    try {
      const url = `${API_BASE}/worlds/pipeline-trace?world_path=${encodeURIComponent(worldPath)}&registry_name=${encodeURIComponent(b.name)}&meta=0`
      const res = await fetch(url)
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = await res.json() as Record<string, any>
      console.group(`[atlas:pipeline] ${b.name}`)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const step of (data.trace ?? []) as { ok: boolean; step: string }[]) {
        console.log(`${step.ok ? '✓' : '✗'} ${step.step}`)
      }
      if (data.resolved) {
        const conf  = data.confidence  ? ` | confidence=${data.confidence}` : ''
        const amb   = data.is_ambiguous ? ' | AMBIGUOUS' : ''
        const side  = data.side_used !== undefined ? ` | side=${data.side_used}` : ''
        const exact = data.meta_exact  === false ? ' | meta→0' : ''
        console.log(
          `%c→ Resolved: ${data.texture_key}  [method=${data.method}${side}${exact}${conf}${amb}]`,
          'color:#34d399',
        )
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const candidates = (data.top_candidates ?? []) as { key: string; score: number; notes: string }[]
        if (candidates.length > 0) {
          console.group('Top candidates:')
          candidates.forEach((c, i) => {
            const marker = i === 0 ? '← chosen' : ''
            console.log(`  ${i + 1}. ${c.key}  score=${c.score}${c.notes ? `  ${c.notes}` : ''}  ${marker}`)
          })
          console.groupEnd()
        }
      } else {
        console.log(`%c→ Failed: ${data.failure_reason}`, 'color:#f87171')
      }
      console.groupEnd()
    } catch (err) {
      console.error('[atlas:pipeline] Trace failed:', err)
    } finally {
      setTracing(false)
    }
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
              {status === 'pending' ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : status === 'missing' ? <X className="h-3.5 w-3.5" aria-hidden /> : status === 'no-mapping' ? '?' : ''}
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

        {/* Tint / method badge */}
        <span className="w-16 shrink-0">
          {tintLabel ? (
            <span className={`rounded px-1 py-0.5 font-mono text-[9px] ${tintClass}`}>
              {tintLabel}
            </span>
          ) : blockMethod ? (
            <span className={`rounded px-1 py-0.5 font-mono text-[9px] ${METHOD_CLASS[blockMethod] ?? 'bg-zinc-800 text-zinc-500'}`}>
              {METHOD_LABEL[blockMethod] ?? blockMethod}
            </span>
          ) : null}
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
            <div className="flex shrink-0 gap-1">
              {worldPath && b.name && (
                <button
                  onClick={() => void traceBlockPipeline()}
                  disabled={tracing}
                  className="inline-flex items-center gap-1 rounded bg-indigo-900 px-1.5 py-0.5 font-mono text-[9px] text-indigo-300 hover:bg-indigo-800 hover:text-indigo-100 disabled:opacity-40"
                  title="Trace blockstate pipeline to console"
                >
                  {tracing ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <Search className="h-3 w-3" aria-hidden />}
                  {tracing ? '…' : 'trace'}
                </button>
              )}
              <button
                onClick={() => void copyJson()}
                className="inline-flex items-center gap-1 rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[9px] text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
                title="Copy suggested JSON rule to clipboard"
              >
                {copied ? <Check className="h-3 w-3" aria-hidden /> : <Copy className="h-3 w-3" aria-hidden />}
                {copied ? 'copied!' : 'copy JSON'}
              </button>
            </div>
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
