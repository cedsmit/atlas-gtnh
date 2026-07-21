import { Compass, Gem, Grid3x3, TriangleAlert, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { DebugMenu } from './menubar/DebugMenu'
import { FileMenu } from './menubar/FileMenu'
import { OverlaysMenu } from './menubar/OverlaysMenu'
import { QuickToggle, Spinner } from './menubar/primitives'
import { SavedMenu } from './menubar/SavedMenu'
import { SearchMenu } from './menubar/SearchMenu'
import { type ElevOverride, type MenuId } from './menubar/types'
import { ViewMenu } from './menubar/ViewMenu'
import {
  type LayerOverrides,
  type LayerTag,
} from '../features/blocks/renderPresets'
import { type UserPreset } from '../features/blocks/userPresets'

interface Props {
  worldPath: string | null
  onWorldSelected: (path: string) => void
  onCloseWorld: () => void
  selectedPresetId?: string
  onSetPreset?: (id: string) => void
  elevOverride?: ElevOverride
  onSetElevOverride?: (v: ElevOverride) => void
  inspectOpen?: boolean
  onToggleInspect?: () => void
  debugOpen?: boolean
  onToggleDebug?: () => void
  diagnosticRender?: boolean
  onToggleDiagnosticRender?: () => void
  searchOpen?: boolean
  onToggleSearch?: () => void
  lootGamesOpen?: boolean
  onToggleLootGames?: () => void
  biomeSearchOpen?: boolean
  onToggleBiomeSearch?: () => void
  oreVeinSearchOpen?: boolean
  onToggleOreVeinSearch?: () => void
  heatmapOn?: boolean
  heatmapLoading?: boolean
  onToggleHeatmap?: () => void
  gridOn?: boolean
  onToggleGrid?: () => void
  oreVeinsOn?: boolean
  oreVeinsLoading?: boolean
  onToggleOreVeins?: () => void
  infraViewOn?: boolean
  onToggleInfra?: () => void
  pipeSystems?: string[]
  hiddenPipeSystems?: ReadonlySet<string>
  onToggleInfraSystem?: (system: string, show: boolean) => void
  showInfraCables?: boolean
  onToggleInfraCables?: () => void
  layerOverrides?: LayerOverrides
  onSetLayer?: (tag: LayerTag, show: boolean) => void
  onResetLayers?: () => void
  userPresets?: UserPreset[]
  onSavePreset?: (name: string) => void
  onApplyPreset?: (p: UserPreset) => void
  onDeletePreset?: (id: string) => void
}

/**
 * The map view's chrome: an identity bar (world + global render filter) above a
 * tools row of grouped menus. Each dropdown lives in `./menubar/`; this shell
 * owns only the "which menu is open" state they share.
 */
export function MenuBar({
  worldPath,
  onWorldSelected,
  onCloseWorld,
  selectedPresetId,
  onSetPreset,
  elevOverride,
  onSetElevOverride,
  inspectOpen,
  onToggleInspect,
  debugOpen,
  onToggleDebug,
  diagnosticRender,
  onToggleDiagnosticRender,
  searchOpen,
  onToggleSearch,
  lootGamesOpen,
  onToggleLootGames,
  biomeSearchOpen,
  onToggleBiomeSearch,
  oreVeinSearchOpen,
  onToggleOreVeinSearch,
  heatmapOn,
  heatmapLoading,
  onToggleHeatmap,
  gridOn,
  onToggleGrid,
  oreVeinsOn,
  oreVeinsLoading,
  onToggleOreVeins,
  infraViewOn,
  onToggleInfra,
  pipeSystems,
  hiddenPipeSystems,
  onToggleInfraSystem,
  showInfraCables,
  onToggleInfraCables,
  layerOverrides,
  onSetLayer,
  onResetLayers,
  userPresets,
  onSavePreset,
  onApplyPreset,
  onDeletePreset,
}: Props) {
  const [menu, setMenu] = useState<MenuId | null>(null)
  const [error, setError] = useState<string | null>(null)
  const headerRef = useRef<HTMLElement>(null)

  const toggleMenu = (id: MenuId) => setMenu((m) => (m === id ? null : id))
  const closeMenu = () => setMenu(null)

  // One listener for every dropdown: they all live inside the header, so a click
  // outside it closes whichever is open (clicking another trigger just switches).
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (!headerRef.current?.contains(e.target as Node)) setMenu(null)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const showTools =
    !!worldPath &&
    (!!onSetPreset ||
      !!onToggleSearch ||
      !!onToggleGrid ||
      !!onSavePreset ||
      !!onToggleDebug)

  return (
    <header ref={headerRef} className="shrink-0">
      {/* ── Identity bar ─────────────────────────────────────────────── */}
      <div className="flex h-11 items-center gap-3 border-b border-zinc-800 bg-atlas-bar px-4">
        <span className="inline-flex items-center gap-2 text-sm font-semibold text-zinc-100">
          <Compass
            className="h-[17px] w-[17px] shrink-0 text-atlas-accent"
            aria-hidden
          />
          Atlas
        </span>

        <FileMenu
          open={menu === 'file'}
          onToggle={() => toggleMenu('file')}
          onClose={closeMenu}
          worldPath={worldPath}
          onWorldSelected={onWorldSelected}
          onCloseWorld={onCloseWorld}
          onError={setError}
        />

        {worldPath && (
          <>
            <span className="h-4 w-px bg-zinc-800" />
            <span
              className="h-[7px] w-[7px] shrink-0 rounded-full bg-atlas-accent"
              style={{ boxShadow: '0 0 8px #34d39988' }}
            />
            <span
              className="min-w-0 flex-1 truncate font-mono text-xs text-zinc-500"
              title={worldPath}
            >
              {worldPath}
            </span>
          </>
        )}
      </div>

      {/* ── Tools row ────────────────────────────────────────────────── */}
      {showTools && (
        <div className="flex h-12 items-center gap-2.5 border-b border-zinc-800 bg-atlas-row px-4">
          {onSetPreset && selectedPresetId && (
            <ViewMenu
              open={menu === 'view'}
              onToggle={() => toggleMenu('view')}
              selectedPresetId={selectedPresetId}
              onSetPreset={onSetPreset}
              elevOverride={elevOverride}
              onSetElevOverride={onSetElevOverride}
              layerOverrides={layerOverrides}
              onSetLayer={onSetLayer}
              onResetLayers={onResetLayers}
            />
          )}

          {(onToggleGrid ||
            onToggleOreVeins ||
            onToggleHeatmap ||
            onToggleInfra) && (
            <OverlaysMenu
              open={menu === 'overlays'}
              onToggle={() => toggleMenu('overlays')}
              heatmapOn={heatmapOn}
              heatmapLoading={heatmapLoading}
              onToggleHeatmap={onToggleHeatmap}
              gridOn={gridOn}
              onToggleGrid={onToggleGrid}
              oreVeinsOn={oreVeinsOn}
              oreVeinsLoading={oreVeinsLoading}
              onToggleOreVeins={onToggleOreVeins}
              infraViewOn={infraViewOn}
              onToggleInfra={onToggleInfra}
              pipeSystems={pipeSystems}
              hiddenPipeSystems={hiddenPipeSystems}
              onToggleInfraSystem={onToggleInfraSystem}
              showInfraCables={showInfraCables}
              onToggleInfraCables={onToggleInfraCables}
            />
          )}

          {(onToggleSearch ||
            onToggleLootGames ||
            onToggleBiomeSearch ||
            onToggleOreVeinSearch) && (
            <SearchMenu
              open={menu === 'search'}
              onToggle={() => toggleMenu('search')}
              onClose={closeMenu}
              searchOpen={searchOpen}
              onToggleSearch={onToggleSearch}
              lootGamesOpen={lootGamesOpen}
              onToggleLootGames={onToggleLootGames}
              biomeSearchOpen={biomeSearchOpen}
              onToggleBiomeSearch={onToggleBiomeSearch}
              oreVeinSearchOpen={oreVeinSearchOpen}
              onToggleOreVeinSearch={onToggleOreVeinSearch}
            />
          )}

          {onSavePreset && (
            <SavedMenu
              open={menu === 'saved'}
              onToggle={() => toggleMenu('saved')}
              onClose={closeMenu}
              userPresets={userPresets}
              onSavePreset={onSavePreset}
              onApplyPreset={onApplyPreset}
              onDeletePreset={onDeletePreset}
            />
          )}

          {/* Right side — quick toggles + debug */}
          <div className="ml-auto flex items-center gap-2">
            {onToggleGrid && (
              <QuickToggle
                on={!!gridOn}
                onClick={onToggleGrid}
                icon={<Grid3x3 />}
                tone="accent"
                title="Chunk/region grid + coordinate labels"
              >
                Grid
              </QuickToggle>
            )}
            {onToggleOreVeins && (
              <QuickToggle
                on={!!oreVeinsOn}
                onClick={onToggleOreVeins}
                icon={oreVeinsLoading ? <Spinner /> : <Gem />}
                tone="amber"
                title="Ore veins from Visual Prospecting"
              >
                Veins
              </QuickToggle>
            )}

            {(onToggleDebug || onToggleInspect) && (
              <DebugMenu
                open={menu === 'debug'}
                onToggle={() => toggleMenu('debug')}
                onClose={closeMenu}
                worldPath={worldPath}
                inspectOpen={inspectOpen}
                onToggleInspect={onToggleInspect}
                debugOpen={debugOpen}
                onToggleDebug={onToggleDebug}
                diagnosticRender={diagnosticRender}
                onToggleDiagnosticRender={onToggleDiagnosticRender}
              />
            )}
          </div>
        </div>
      )}

      {/* ── Error ────────────────────────────────────────────────────── */}
      {error && (
        <div className="flex items-center gap-2 border-b border-atlas-danger/30 bg-atlas-danger/10 px-4 py-2">
          <TriangleAlert
            className="h-4 w-4 shrink-0 text-atlas-danger"
            aria-hidden
          />
          <span className="text-xs text-atlas-danger">{error}</span>
          <button
            onClick={() => setError(null)}
            className="ml-auto text-zinc-600 transition-colors hover:text-zinc-300"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      )}
    </header>
  )
}
