import { useEffect, useRef, useState, type MutableRefObject } from 'react'

import type { MapEngine } from '../map/mapEngine'
import type { FluidsProspectingField } from './api/fluidsProspecting'
import { fluidDisplay } from './fluidDisplay'
import type { RigRecommendation } from './rigPlanner'

interface Props {
  engineRef: MutableRefObject<MapEngine | null>
  fields: FluidsProspectingField[]
  rigPlacement?: RigRecommendation | null
  rigLabel?: string
}

interface Viewport {
  cx: number
  cz: number
  scale: number
  w: number
  h: number
}

const FIELD_BLOCKS = 128
const CHUNK_BLOCKS = 16
const MAX_FIELDS = 300

export function FluidsProspectingOverlay({
  engineRef,
  fields,
  rigPlacement,
  rigLabel,
}: Props) {
  const [viewport, setViewport] = useState<Viewport | null>(null)
  const previous = useRef<Viewport | null>(null)

  useEffect(() => {
    let frame = 0
    const tick = () => {
      const next = engineRef.current?.getViewport()
      const old = previous.current
      if (
        next &&
        (!old ||
          old.cx !== next.cx ||
          old.cz !== next.cz ||
          old.scale !== next.scale ||
          old.w !== next.w ||
          old.h !== next.h)
      ) {
        previous.current = next
        setViewport(next)
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [engineRef])

  if (!viewport) return null
  const { cx, cz, scale, w, h } = viewport
  const size = FIELD_BLOCKS * scale
  const showCells = CHUNK_BLOCKS * scale >= 17
  const visible = fields
    .map((field) => ({
      field,
      left: (field.chunk_x * CHUNK_BLOCKS - cx) * scale + w / 2,
      top: (field.chunk_z * CHUNK_BLOCKS - cz) * scale + h / 2,
    }))
    .filter(
      ({ left, top }) =>
        left + size >= 0 && left <= w && top + size >= 0 && top <= h
    )
    .slice(0, MAX_FIELDS)
  const rigArea = rigPlacement
    ? {
        left: (rigPlacement.areaChunkX * CHUNK_BLOCKS - cx) * scale + w / 2,
        top: (rigPlacement.areaChunkZ * CHUNK_BLOCKS - cz) * scale + h / 2,
        size: rigPlacement.range * CHUNK_BLOCKS * scale,
        controllerLeft:
          (rigPlacement.controllerChunkX * CHUNK_BLOCKS - cx) * scale + w / 2,
        controllerTop:
          (rigPlacement.controllerChunkZ * CHUNK_BLOCKS - cz) * scale + h / 2,
        controllerSize: CHUNK_BLOCKS * scale,
        controllerMarkerSize: Math.min(22, Math.max(10, scale)),
      }
    : null

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden font-mono">
      {visible.map(({ field, left, top }) => {
        const display = fluidDisplay(field.fluid)
        const fieldColor = field.empty ? '#a3a3a3' : display.color
        const label = field.empty
          ? 'Empty'
          : `${display.name} · ${field.min_yield}–${field.max_yield} L/op per chunk`
        return (
          <div
            key={`${field.chunk_x},${field.chunk_z}`}
            className="absolute border"
            style={{
              left,
              top,
              width: size,
              height: size,
              borderColor: fieldColor,
              opacity: field.empty ? 0.5 : 1,
              boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${fieldColor} 35%, transparent)`,
            }}
          >
            {showCells && !field.empty && field.yields.length === 64 && (
              <div className="absolute inset-0 grid grid-cols-8 grid-rows-8">
                {field.yields.map((value, index) => {
                  const range = field.max_yield - field.min_yield + 1
                  const strength =
                    value > 0
                      ? range > 1
                        ? (value - field.min_yield) / range
                        : 0.04
                      : 0
                  const backgroundStrength =
                    value > 0 ? Math.round(18 + strength * 68) : 0
                  const fontSize = Math.min(
                    13,
                    Math.max(10, CHUNK_BLOCKS * scale * 0.16)
                  )
                  return (
                    <span
                      key={index}
                      className="flex items-center justify-center border border-black/30"
                      style={{
                        backgroundColor:
                          value > 0
                            ? `color-mix(in srgb, ${display.color} ${backgroundStrength}%, transparent)`
                            : 'transparent',
                      }}
                    >
                      {value > 0 && (
                        <span
                          className="bg-black/65 px-1 py-px font-semibold leading-none text-white shadow-sm"
                          style={{
                            fontSize,
                            textShadow: '0 1px 2px #000, 0 0 3px #000',
                          }}
                        >
                          {value}
                        </span>
                      )}
                    </span>
                  )
                })}
              </div>
            )}
            {size >= 70 && (
              <span className="absolute left-0 top-0 max-w-full truncate bg-black/80 px-1 text-[11px] leading-4 text-white">
                {label}
              </span>
            )}
          </div>
        )
      })}
      {rigArea && rigPlacement && (
        <div
          className="absolute border-2 border-cyan-300 bg-cyan-300/10 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.75),0_0_8px_rgba(103,232,249,0.8)]"
          style={{
            left: rigArea.left,
            top: rigArea.top,
            width: rigArea.size,
            height: rigArea.size,
          }}
        >
          <span className="absolute bottom-full left-[-2px] whitespace-nowrap rounded-t bg-cyan-950/95 px-1.5 py-0.5 text-[11px] font-semibold text-cyan-100 shadow">
            {rigLabel ?? 'Oil drilling rig'} · Σ{' '}
            {rigPlacement.totalYield.toLocaleString()} L/op · ~
            {rigPlacement.estimatedLitersPerSecond.toLocaleString(undefined, {
              maximumFractionDigits: 1,
            })}{' '}
            L/s
          </span>
        </div>
      )}
      {rigArea && rigPlacement && (
        <div
          className="absolute border border-dashed border-white/60 bg-white/[0.03]"
          style={{
            left: rigArea.controllerLeft,
            top: rigArea.controllerTop,
            width: rigArea.controllerSize,
            height: rigArea.controllerSize,
          }}
          title={`Place the controller anywhere in chunk ${rigPlacement.controllerChunkX}, ${rigPlacement.controllerChunkZ}`}
        >
          <span
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 border-2 border-white bg-cyan-400 shadow-[0_0_0_2px_rgba(0,0,0,0.8),0_0_8px_rgba(103,232,249,1)]"
            style={{
              width: rigArea.controllerMarkerSize,
              height: rigArea.controllerMarkerSize,
            }}
          />
          {rigArea.controllerSize >= 76 && (
            <span
              className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap bg-black/80 px-1 text-[9px] leading-4 text-white"
              style={{
                top:
                  rigArea.controllerSize / 2 +
                  rigArea.controllerMarkerSize / 2 +
                  3,
              }}
            >
              suggested controller
            </span>
          )}
        </div>
      )}
    </div>
  )
}
