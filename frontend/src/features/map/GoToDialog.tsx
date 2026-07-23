import { Crosshair, MapPin } from 'lucide-react'
import { type ClipboardEvent, type RefObject, useRef, useState } from 'react'

import { Dialog, DialogCancel, DialogConfirm } from '../../shared/Dialog'
import { coordinateError, parseCoordinates } from './goToCoords'

/**
 * Fly the map to a block position.
 *
 * Opened by double-clicking the map, and seeded with the point that was
 * double-clicked: the numbers are then an anchor to adjust rather than a blank
 * pair of boxes, and the field shows its own format without having to explain
 * it.
 *
 * Replaces a native `prompt()`, which took one comma-joined string, matched
 * nothing else in the app, and silently did nothing when it could not parse
 * what it was given.
 */
export function GoToDialog({
  at,
  onGo,
  onClose,
}: {
  /** The double-clicked block position, used as the starting values. */
  at: { worldX: number; worldZ: number }
  onGo: (x: number, z: number) => void
  onClose: () => void
}) {
  const [x, setX] = useState(String(at.worldX))
  const [z, setZ] = useState(String(at.worldZ))
  /** Errors stay hidden until submit — typing a minus sign is not a mistake. */
  const [showErrors, setShowErrors] = useState(false)
  const firstField = useRef<HTMLInputElement>(null)

  const errors = { x: coordinateError(x), z: coordinateError(z) }
  const valid = !errors.x && !errors.z

  function submit() {
    if (!valid) return setShowErrors(true)
    onGo(Number(x), Number(z))
  }

  /**
   * Coordinates are usually pasted, not typed — off the F3 screen or out of a
   * chat message — and they arrive as one string holding both numbers. Split
   * that across the fields instead of dropping it all into this one.
   */
  function onPaste(e: ClipboardEvent<HTMLInputElement>) {
    const pair = parseCoordinates(e.clipboardData.getData('text'))
    if (!pair) return
    e.preventDefault()
    setX(String(pair[0]))
    setZ(String(pair[1]))
    setShowErrors(false)
  }

  return (
    <Dialog
      title="Go to coordinates"
      icon={
        <MapPin
          className="mt-0.5 h-4 w-4 shrink-0 text-atlas-accent"
          aria-hidden
        />
      }
      onClose={onClose}
      initialFocusRef={firstField}
      footer={
        <>
          <DialogConfirm onClick={submit} disabled={!valid}>
            <Crosshair className="h-3.5 w-3.5" aria-hidden />
            Go
          </DialogConfirm>
          <DialogCancel onClick={onClose} />
        </>
      }
    >
      <div className="flex gap-2">
        <Field
          label="X"
          value={x}
          onChange={setX}
          onPaste={onPaste}
          onSubmit={submit}
          error={showErrors ? errors.x : null}
          inputRef={firstField}
        />
        <Field
          label="Z"
          value={z}
          onChange={setZ}
          onPaste={onPaste}
          onSubmit={submit}
          error={showErrors ? errors.z : null}
        />
      </div>
      <p className="text-[11px] leading-relaxed text-zinc-500">
        Block coordinates, not chunks. Pasting a pair — or a whole{' '}
        <code>XYZ</code> line from F3 — fills both fields.
      </p>
    </Dialog>
  )
}

function Field({
  label,
  value,
  onChange,
  onPaste,
  onSubmit,
  error,
  inputRef,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  onPaste: (e: ClipboardEvent<HTMLInputElement>) => void
  onSubmit: () => void
  error: string | null
  inputRef?: RefObject<HTMLInputElement>
}) {
  return (
    <label className="flex-1">
      <span className="mb-1 block text-[10px] uppercase tracking-[0.12em] text-zinc-600">
        {label}
      </span>
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onPaste={onPaste}
        // Enter submits from either field — this is a two-box form, and
        // reaching for the mouse to finish it would be silly.
        onKeyDown={(e) => e.key === 'Enter' && onSubmit()}
        // Not type="number": it rejects a pasted "12, 34" outright, and its
        // spinners are noise on a coordinate.
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        className={`w-full rounded-md border bg-atlas-input px-2.5 py-1.5 font-mono text-xs text-zinc-100 outline-none transition-colors focus:border-atlas-accent ${
          error ? 'border-atlas-danger' : 'border-zinc-700'
        }`}
      />
      {error && (
        <span className="mt-1 block text-[10px] text-atlas-danger">
          {error}
        </span>
      )}
    </label>
  )
}
