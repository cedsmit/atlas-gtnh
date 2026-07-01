import { Check, TriangleAlert, Loader2 } from 'lucide-react'

export type LoadingStage =
  | 'scanning'
  | 'registry'
  | 'textures'
  | 'tiles'

interface Props {
  stage?: LoadingStage
  /** Texture image loading counters */
  texLoaded?: number
  texMissing?: number
  texTotal?: number
  /** Mod-JAR scan progress (scanning stage) */
  scanCurrent?: string
  scanScanned?: number
  scanTotal?: number
  /** null = still detecting, true = found, false = not found */
  vanillaJarFound?: boolean | null
}

const STAGE_TITLE: Record<LoadingStage, string> = {
  scanning: 'Scanning Mods',
  registry: 'Building Block Registry',
  textures: 'Loading Textures',
  tiles: 'Preparing Map',
}

const STAGE_HINT: Record<LoadingStage, string> = {
  scanning: 'Extracting block colors from mod JARs…',
  registry: 'Mapping block IDs to texture keys…',
  textures: '',
  tiles: 'Rendering initial map tiles…',
}

const STAGES: LoadingStage[] = ['scanning', 'registry', 'textures', 'tiles']

export function LoadingScreen({
  stage = 'scanning',
  texLoaded = 0,
  texMissing = 0,
  texTotal = 0,
  scanCurrent = '',
  scanScanned = 0,
  scanTotal = 0,
  vanillaJarFound,
}: Props) {
  const stageIdx = STAGES.indexOf(stage)

  const progress =
    stage === 'textures' && texTotal > 0
      ? (texLoaded + texMissing) / texTotal
      : stage === 'scanning' && scanTotal > 0
        ? scanScanned / scanTotal
        : null

  const hint =
    stage === 'textures'
      ? `${texLoaded.toLocaleString()} / ${texTotal.toLocaleString()} images loaded` +
        (texMissing > 0 ? ` · ${texMissing} missing` : '') +
        ((texTotal - texLoaded - texMissing) > 0
          ? ` · ${(texTotal - texLoaded - texMissing).toLocaleString()} pending`
          : '')
      : stage === 'scanning' && scanTotal > 0
        ? `${scanCurrent || '…'} · ${scanScanned} / ${scanTotal} mods`
        : STAGE_HINT[stage]

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 px-8">
      {/* Stage title */}
      <div className="max-w-lg text-center">
        <h2 className="text-xl font-semibold text-zinc-100">{STAGE_TITLE[stage]}</h2>
        <p className="mt-1 truncate font-mono text-sm text-zinc-400">{hint}</p>
      </div>

      {/* Progress bar */}
      <div className="w-full max-w-md">
        <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
          {progress !== null ? (
            <div
              className="h-full rounded-full bg-emerald-500 transition-[width] duration-200"
              style={{ width: `${Math.max(1, progress * 100)}%` }}
            />
          ) : (
            <div className="h-full w-1/3 animate-[slide_1.4s_ease-in-out_infinite] rounded-full bg-emerald-500" />
          )}
        </div>
      </div>

      {/* Stage steps */}
      <div className="flex items-center gap-3">
        {STAGES.map((s, i) => (
          <div key={s} className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <div
                className={`h-2 w-2 rounded-full transition-colors ${
                  i < stageIdx
                    ? 'bg-emerald-500'
                    : i === stageIdx
                      ? 'bg-emerald-400 animate-pulse'
                      : 'bg-zinc-700'
                }`}
              />
              <span
                className={`text-xs ${
                  i < stageIdx
                    ? 'text-emerald-500'
                    : i === stageIdx
                      ? 'text-zinc-200'
                      : 'text-zinc-600'
                }`}
              >
                {STAGE_TITLE[s]}
              </span>
            </div>
            {i < STAGES.length - 1 && (
              <div className={`h-px w-6 ${i < stageIdx ? 'bg-emerald-800' : 'bg-zinc-800'}`} />
            )}
          </div>
        ))}
      </div>

      {/* Vanilla JAR status — shown during and after the textures stage */}
      {(stage === 'textures' || stage === 'tiles') && (
        <div
          className={`flex items-center gap-2 rounded-full border px-4 py-1.5 text-xs font-medium transition-colors ${
            vanillaJarFound === true
              ? 'border-emerald-700 bg-emerald-950 text-emerald-400'
              : vanillaJarFound === false
                ? 'border-amber-700 bg-amber-950 text-amber-400'
                : 'border-zinc-700 bg-zinc-900 text-zinc-500'
          }`}
        >
          {vanillaJarFound === true ? (
            <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />
          ) : vanillaJarFound === false ? (
            <TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />
          ) : (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
          )}
          {vanillaJarFound === true
            ? 'Vanilla JAR found — full block textures'
            : vanillaJarFound === false
              ? 'Vanilla JAR not found — using fallback colors'
              : 'Detecting vanilla JAR…'}
        </div>
      )}
    </div>
  )
}
