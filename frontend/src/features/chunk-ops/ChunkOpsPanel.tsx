import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Boxes,
  ClipboardCopy,
  ClipboardPaste,
  FolderPlus,
  Loader2,
  RotateCw,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'

import type { ChunkOps, Destructive } from './useChunkOps'

/**
 * Chunk tools: select a region of the save, then copy it, paste it elsewhere,
 * or delete it so Minecraft regenerates it.
 *
 * The only part of Atlas that writes to a world, so the warning is permanent
 * rather than tucked into a confirm, and the two delete operations are separate
 * buttons — they used to be one button whose meaning flipped with a checkbox.
 */
export function ChunkOpsPanel({
  ops,
  onClose,
}: {
  ops: ChunkOps
  onClose: () => void
}) {
  const [confirming, setConfirming] = useState<Destructive | null>(null)
  const { selection, count, clipboard, busy } = ops

  return (
    <div className="flex h-full w-96 shrink-0 flex-col border-l border-zinc-800 bg-atlas-row">
      <header className="flex shrink-0 items-center gap-2.5 border-b border-zinc-800 px-4 py-3">
        <Boxes className="h-4 w-4 shrink-0 text-atlas-accent" aria-hidden />
        <span className="text-[13.5px] font-semibold text-zinc-100">
          Chunk tools
        </span>
        <button
          onClick={onClose}
          aria-label="Close"
          className="ml-auto text-zinc-600 transition-colors hover:text-zinc-300"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </header>

      <div className="flex items-start gap-2 border-b border-atlas-amber-line bg-atlas-amber-bg px-4 py-2.5">
        <TriangleAlert
          className="mt-px h-3.5 w-3.5 shrink-0 text-atlas-amber"
          aria-hidden
        />
        <p className="text-[11px] leading-relaxed text-atlas-amber">
          These write to the save. Close the world in Minecraft first — writing
          a loaded save can corrupt it. A <code>.bak</code> is kept from the
          first edit only, so it is not an undo.
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {ops.mode === 'paste' && clipboard ? (
          <PasteStep ops={ops} />
        ) : (
          <>
            <Step n={1} label="Select">
              {selection ? (
                <>
                  <p className="font-mono text-xs text-zinc-300">
                    ({selection.cx0}, {selection.cz0}) – ({selection.cx1},{' '}
                    {selection.cz1})
                  </p>
                  <p className="mt-1 text-xs text-zinc-500">
                    {count} chunk{count === 1 ? '' : 's'} ·{' '}
                    <button
                      onClick={ops.clearSelection}
                      disabled={busy}
                      className="underline decoration-zinc-700 underline-offset-2 hover:text-zinc-300"
                    >
                      clear
                    </button>
                  </p>
                </>
              ) : (
                <p className="text-xs text-zinc-500">
                  Drag a box on the map to choose chunks.
                </p>
              )}
            </Step>

            <Step n={2} label="Act on the selection" dim={!selection}>
              <div className="flex flex-col gap-1.5">
                <Action
                  onClick={ops.copy}
                  disabled={!selection || busy}
                  icon={<ClipboardCopy />}
                >
                  Copy {selection ? `${count} chunk(s)` : ''}
                </Action>

                {confirming ? (
                  <Confirm
                    kind={confirming}
                    count={count}
                    busy={busy}
                    onCancel={() => setConfirming(null)}
                    onConfirm={async () => {
                      await ops.runDestructive(confirming)
                      setConfirming(null)
                    }}
                  />
                ) : (
                  <>
                    <Action
                      onClick={() => setConfirming('delete')}
                      disabled={!selection || busy}
                      icon={<Trash2 />}
                      danger
                    >
                      Delete selection
                    </Action>
                    <Action
                      onClick={() => setConfirming('deleteExcept')}
                      disabled={!selection || busy}
                      icon={<Trash2 />}
                      danger
                    >
                      Delete everything else
                    </Action>
                  </>
                )}
              </div>
            </Step>

            {clipboard && (
              <Step n={3} label="Clipboard">
                <p className="mb-2 text-xs text-zinc-500">
                  {clipboard.chunks.length} chunk(s) from{' '}
                  <span className="font-mono">
                    {baseName(clipboard.srcWorld)}
                  </span>
                </p>
                <Action onClick={ops.enterPaste} icon={<ClipboardPaste />}>
                  Paste into this world…
                </Action>
              </Step>
            )}
          </>
        )}
      </div>

      {ops.result && (
        <p
          className={`shrink-0 border-t border-zinc-800 px-4 py-2.5 text-xs ${
            ops.error ? 'text-atlas-danger' : 'text-atlas-accent'
          }`}
        >
          {ops.result}
        </p>
      )}
    </div>
  )
}

function PasteStep({ ops }: { ops: ChunkOps }) {
  const [confirming, setConfirming] = useState(false)
  const { anchor, clipboard, busy } = ops
  if (!clipboard) return null
  return (
    <>
      <Step n={1} label="Place">
        <p className="text-xs text-zinc-500">
          Click the map to position the {clipboard.chunks.length}-chunk paste,
          then nudge or turn it.
        </p>

        {/* Rotation is the one control here that can be wrong in a way the map
            cannot show: blocks land correctly, but a machine's facing is only
            as good as our rules for its mod. Say so where the choice is made,
            not in a result message after the save has been written. */}
        <div className="mt-2.5 rounded-lg border border-atlas-amber-line bg-atlas-amber-bg p-2.5">
          <div className="flex items-center gap-2">
            <RotateCw
              className="h-3.5 w-3.5 shrink-0 text-atlas-amber"
              aria-hidden
            />
            <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-atlas-amber">
              Rotate
            </span>
            <span className="rounded border border-atlas-amber-line px-1.5 py-px text-[9px] uppercase tracking-wider text-atlas-amber">
              WIP
            </span>
            <span className="ml-auto font-mono text-xs text-zinc-300">
              {ops.turn}°
            </span>
          </div>

          <div className="mt-2 flex gap-1.5">
            <Action onClick={ops.rotate} disabled={busy} icon={<RotateCw />}>
              Turn 90° clockwise
            </Action>
          </div>

          <p className="mt-2 text-[11px] leading-relaxed text-atlas-amber">
            Blocks and terrain turn exactly. Machine and pipe facing is
            best-effort — mods store it in their own way, so some may come out
            pointing the wrong direction.{' '}
            <strong>Back up the world first</strong>, and check your machines
            after pasting.
          </p>
        </div>
        {anchor && (
          <div className="mt-2 flex items-center gap-2">
            <span className="font-mono text-xs text-zinc-300">
              {anchor.cx}, {anchor.cz}
            </span>
            <div className="ml-auto grid grid-cols-3 gap-0.5">
              <span />
              <Nudge onClick={() => ops.nudge(0, -1)} label="Up">
                <ArrowUp className="h-3 w-3" aria-hidden />
              </Nudge>
              <span />
              <Nudge onClick={() => ops.nudge(-1, 0)} label="Left">
                <ArrowLeft className="h-3 w-3" aria-hidden />
              </Nudge>
              <span />
              <Nudge onClick={() => ops.nudge(1, 0)} label="Right">
                <ArrowRight className="h-3 w-3" aria-hidden />
              </Nudge>
              <span />
              <Nudge onClick={() => ops.nudge(0, 1)} label="Down">
                <ArrowDown className="h-3 w-3" aria-hidden />
              </Nudge>
              <span />
            </div>
          </div>
        )}
      </Step>

      <Step n={2} label="Paste">
        <div className="flex flex-col gap-1.5">
          <Action
            onClick={() => setConfirming(true)}
            disabled={!anchor || busy}
            icon={busy ? <Spin /> : <ClipboardPaste />}
          >
            Paste here
          </Action>
          <Action
            onClick={() => void ops.pasteToNewWorld()}
            disabled={!anchor || busy}
            icon={busy ? <Spin /> : <FolderPlus />}
          >
            Paste into a new world…
          </Action>
          <Action onClick={ops.exitPaste} disabled={busy} icon={<X />}>
            Cancel paste
          </Action>
        </div>
      </Step>

      {confirming && anchor && (
        <PasteDialog
          ops={ops}
          onCancel={() => setConfirming(false)}
          onConfirm={async () => {
            await ops.pasteHere()
            setConfirming(false)
          }}
        />
      )}
    </>
  )
}

/**
 * Last stop before the only irreversible thing this panel does.
 *
 * A modal rather than an inline confirm because the click that opens it is two
 * lines below the click that would dismiss it — with the map still showing a
 * preview, it is easy to keep clicking. This one has to be read.
 *
 * It restates the destination, because the anchor can be nudged out of view,
 * and it is blunt about the backup: `backup_region` snapshots a region **once**
 * and never overwrites that snapshot, so on any second operation the `.bak` is
 * an older state, not the state from just before this paste.
 */
function PasteDialog({
  ops,
  onConfirm,
  onCancel,
}: {
  ops: ChunkOps
  onConfirm: () => void
  onCancel: () => void
}) {
  const { anchor, clipboard, turn, busy } = ops
  const cancelRef = useRef<HTMLButtonElement>(null)

  // Escape cancels, and focus starts on Cancel so a stray Enter is harmless.
  useEffect(() => {
    cancelRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel, busy])

  if (!clipboard || !anchor) return null
  const n = clipboard.chunks.length

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={() => !busy && onCancel()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="paste-confirm-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-xl border border-zinc-700 bg-atlas-row shadow-2xl"
      >
        <div className="flex items-start gap-2.5 border-b border-zinc-800 px-4 py-3">
          <TriangleAlert
            className="mt-0.5 h-4 w-4 shrink-0 text-atlas-amber"
            aria-hidden
          />
          <h2
            id="paste-confirm-title"
            className="text-[13.5px] font-semibold text-zinc-100"
          >
            Write {n} chunk{n === 1 ? '' : 's'} to this world?
          </h2>
        </div>

        <div className="space-y-2.5 px-4 py-3">
          <dl className="space-y-1 text-xs">
            <Row label="Landing at">
              <span className="font-mono">
                {anchor.cx}, {anchor.cz}
              </span>
            </Row>
            <Row label="Rotation">{turn ? `${turn}° clockwise` : 'none'}</Row>
          </dl>

          <p className="text-xs leading-relaxed text-zinc-400">
            Anything already in those chunks is replaced.
          </p>

          <p className="rounded-md border border-atlas-amber-line bg-atlas-amber-bg px-2.5 py-2 text-[11px] leading-relaxed text-atlas-amber">
            <strong>This cannot be undone from Atlas.</strong> A{' '}
            <code>.bak</code> of each region is kept only from the{' '}
            <em>first</em> time Atlas edited it — after that it is an older
            state, not the one from just before this paste. Back up the world
            yourself if it matters.
            {turn
              ? ' Machine and pipe facing is best-effort when rotated.'
              : ''}
          </p>
        </div>

        <div className="flex gap-1.5 border-t border-zinc-800 px-4 py-3">
          <button
            onClick={onConfirm}
            disabled={busy}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md bg-atlas-accent px-3 py-2 text-xs font-semibold text-[#08140a] transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {busy ? (
              <Spin />
            ) : (
              <ClipboardPaste className="h-3.5 w-3.5" aria-hidden />
            )}
            {busy ? 'Writing…' : 'Paste'}
          </button>
          <button
            ref={cancelRef}
            onClick={onCancel}
            disabled={busy}
            className="rounded-md border border-zinc-700 px-3 py-2 text-xs text-zinc-300 transition-colors hover:bg-atlas-hover disabled:opacity-40"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="ml-auto text-zinc-200">{children}</dd>
    </div>
  )
}

function Confirm({
  kind,
  count,
  busy,
  onConfirm,
  onCancel,
}: {
  kind: Destructive
  count: number
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const everythingElse = kind === 'deleteExcept'
  return (
    <div className="rounded-lg border border-atlas-danger/40 bg-atlas-danger/10 p-3">
      <p className="text-xs text-zinc-200">
        {everythingElse ? (
          <>
            Delete <strong>the entire dimension except</strong> these {count}{' '}
            chunk(s)?
          </>
        ) : (
          <>Delete these {count} chunk(s) so Minecraft regenerates them?</>
        )}
      </p>
      {everythingElse && (
        <p className="mt-1.5 text-xs text-atlas-danger">
          Everything outside the selection is wiped — check it covers your base.
        </p>
      )}
      <div className="mt-2.5 flex gap-1.5">
        <button
          onClick={onConfirm}
          disabled={busy}
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md bg-atlas-danger px-3 py-2 text-xs font-semibold text-[#1a0808] transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {busy ? <Spin /> : <Trash2 className="h-3.5 w-3.5" aria-hidden />}
          {busy ? 'Working…' : everythingElse ? 'Delete the rest' : 'Delete'}
        </button>
        <button
          onClick={onCancel}
          disabled={busy}
          className="rounded-md border border-zinc-700 px-3 py-2 text-xs text-zinc-300 transition-colors hover:bg-atlas-hover disabled:opacity-40"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

/* ── bits ─────────────────────────────────────────────────────────────── */

const baseName = (p: string) =>
  p
    .replace(/[\\/]+$/, '')
    .split(/[\\/]/)
    .pop() ?? p

function Spin() {
  return <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
}

function Step({
  n,
  label,
  dim,
  children,
}: {
  n: number
  label: string
  dim?: boolean
  children: ReactNode
}) {
  return (
    <section
      className={`border-b border-zinc-800 px-4 py-3 transition-opacity ${
        dim ? 'opacity-40' : ''
      }`}
    >
      <p className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-[0.12em] text-zinc-600">
        <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-zinc-800 text-[9px] text-zinc-400">
          {n}
        </span>
        {label}
      </p>
      {children}
    </section>
  )
}

function Action({
  onClick,
  disabled,
  icon,
  danger,
  children,
}: {
  onClick: () => void
  disabled?: boolean
  icon: ReactNode
  danger?: boolean
  children: ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-[13px] transition-colors disabled:opacity-40 ${
        danger
          ? 'border-atlas-danger/40 text-atlas-danger hover:bg-atlas-danger/10'
          : 'border-zinc-700 text-zinc-300 hover:bg-atlas-hover hover:text-zinc-100'
      }`}
    >
      <span className="[&>svg]:h-3.5 [&>svg]:w-3.5 [&>svg]:shrink-0">
        {icon}
      </span>
      {children}
    </button>
  )
}

function Nudge({
  onClick,
  label,
  children,
}: {
  onClick: () => void
  label: string
  children: ReactNode
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="inline-flex h-5 w-5 items-center justify-center rounded border border-zinc-700 text-zinc-400 transition-colors hover:bg-atlas-hover hover:text-zinc-100"
    >
      {children}
    </button>
  )
}
