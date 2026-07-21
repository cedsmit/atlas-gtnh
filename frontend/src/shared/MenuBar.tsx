import { Compass, Gem, Grid3x3, TriangleAlert, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { DebugMenu, type DebugConfig } from './menubar/DebugMenu'
import { FileMenu } from './menubar/FileMenu'
import { OverlaysMenu, type OverlaysConfig } from './menubar/OverlaysMenu'
import { QuickToggle, Spinner } from './menubar/primitives'
import { SavedMenu, type SavedConfig } from './menubar/SavedMenu'
import {
  SearchMenu,
  type SearchEntry,
  type SearchId,
} from './menubar/SearchMenu'
import { type MenuId } from './menubar/types'
import { ViewMenu, type ViewConfig } from './menubar/ViewMenu'

interface Props {
  worldPath: string | null
  onWorldSelected: (path: string) => void
  onCloseWorld: () => void
  /**
   * Each tools-row group is optional — omit it and that menu is not offered.
   * App leaves them all out until the map is on screen, which is what makes the
   * row appear complete in one go rather than filling in piecemeal.
   */
  view?: ViewConfig
  overlays?: OverlaysConfig
  search?: Partial<Record<SearchId, SearchEntry>>
  saved?: SavedConfig
  debug?: DebugConfig
}

/**
 * The map view's chrome: an identity bar (world) above a tools row of grouped
 * menus. Each dropdown lives in `./menubar/`; this shell owns only the "which
 * menu is open" state they share.
 */
export function MenuBar({
  worldPath,
  onWorldSelected,
  onCloseWorld,
  view,
  overlays,
  search,
  saved,
  debug,
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

  // The two overlays worth a one-click toggle also live in the Overlays menu —
  // read straight off that config so they cannot drift out of sync with it.
  const grid = overlays?.items.grid
  const veins = overlays?.items.oreVeins

  const showTools =
    !!worldPath && !!(view || overlays || search || saved || debug)

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
          {view && (
            <ViewMenu
              open={menu === 'view'}
              onToggle={() => toggleMenu('view')}
              {...view}
            />
          )}

          {overlays && (
            <OverlaysMenu
              open={menu === 'overlays'}
              onToggle={() => toggleMenu('overlays')}
              {...overlays}
            />
          )}

          {search && (
            <SearchMenu
              open={menu === 'search'}
              onToggle={() => toggleMenu('search')}
              onClose={closeMenu}
              entries={search}
            />
          )}

          {saved && (
            <SavedMenu
              open={menu === 'saved'}
              onToggle={() => toggleMenu('saved')}
              onClose={closeMenu}
              {...saved}
            />
          )}

          {/* Right side — quick toggles + debug */}
          <div className="ml-auto flex items-center gap-2">
            {grid && (
              <QuickToggle
                on={!!grid.on}
                onClick={grid.onToggle}
                icon={<Grid3x3 />}
                tone="accent"
                title="Chunk/region grid + coordinate labels"
              >
                Grid
              </QuickToggle>
            )}
            {veins && (
              <QuickToggle
                on={!!veins.on}
                onClick={veins.onToggle}
                icon={veins.loading ? <Spinner /> : <Gem />}
                tone="amber"
                title="Ore veins from Visual Prospecting"
              >
                Veins
              </QuickToggle>
            )}

            {debug && (
              <DebugMenu
                open={menu === 'debug'}
                onToggle={() => toggleMenu('debug')}
                onClose={closeMenu}
                worldPath={worldPath}
                {...debug}
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
