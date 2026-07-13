import { useEffect, useMemo, useRef, useState } from 'react'

import { getSettledCount, onTextureLoad, warmTextures } from './textureLoader'

export interface TexturePreloadStats {
  done: boolean
  loaded: number
  missing: number
  pending: number
  total: number
  startedAt: number | null
  finishedAt: number | null
}

const EMPTY: TexturePreloadStats = {
  done: false,
  loaded: 0,
  missing: 0,
  pending: 0,
  total: 0,
  startedAt: null,
  finishedAt: null,
}

export function useTexturePreloader(
  textureKeys: Record<number, string> | undefined,
  worldPath: string | null,
  metaTextureKeys?: Record<string, string>
): TexturePreloadStats {
  const [tick, setTick] = useState(0)
  const startRef = useRef<number | null>(null)
  const finishedRef = useRef<number | null>(null)

  // Deduplicated union of regular + meta texture keys.
  // Recalculated only when either map reference changes.
  const keys = useMemo(() => {
    const regular = textureKeys ? Object.values(textureKeys) : []
    const meta = metaTextureKeys ? Object.values(metaTextureKeys) : []
    return meta.length === 0 ? regular : [...new Set([...regular, ...meta])]
  }, [textureKeys, metaTextureKeys])

  useEffect(() => {
    if (keys.length === 0 || !worldPath) return

    startRef.current = performance.now()
    finishedRef.current = null
    console.log(`[atlas:textures] preloading ${keys.length} textures…`)

    warmTextures(keys, worldPath)

    return onTextureLoad(() => setTick((t) => t + 1))
  }, [keys, worldPath])

  return useMemo<TexturePreloadStats>(() => {
    if (keys.length === 0) return { ...EMPTY, done: true }
    const s = getSettledCount(keys)
    const isDone = s.pending === 0
    if (isDone && !finishedRef.current && startRef.current) {
      finishedRef.current = performance.now()
      const elapsed = (finishedRef.current - startRef.current).toFixed(0)
      console.log(
        `[atlas:textures] preload done in ${elapsed}ms — ` +
          `${s.loaded} loaded, ${s.missing} missing`
      )
    }
    return {
      done: isDone,
      loaded: s.loaded,
      missing: s.missing,
      pending: s.pending,
      total: keys.length,
      startedAt: startRef.current,
      finishedAt: isDone ? finishedRef.current : null,
    }
  }, [keys, tick]) // eslint-disable-line react-hooks/exhaustive-deps
}
