import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { API_BASE } from '../../../shared/api'
import type { RegistryJson } from '../blockRenderRegistry'

const QUERY_KEY = ['render-overrides'] as const

async function fetchOverrides(): Promise<RegistryJson> {
  const res = await fetch(`${API_BASE}/worlds/render-overrides`)
  if (!res.ok)
    throw new Error(`Failed to fetch render overrides (${res.status})`)
  return (await res.json()) as RegistryJson
}

/**
 * Authored render-rule overrides (Stage 2.3), a RegistryJson merged into the
 * BlockRenderRegistry as the highest-priority layer. These are written by the
 * maintainer's debug-panel "Save" into the shipped `render-rules/authored.json`
 * (Vite also bundles that file directly); the live fetch here just gives an
 * instant re-render in dev. Stable until a save mutates it.
 */
export function useRenderOverrides() {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchOverrides,
    staleTime: Infinity,
  })
}

export interface SaveOverrideArgs {
  name: string // FML registry name, e.g. "Botania:manaGlass"
  definition: Record<string, unknown> // BlockRenderDefinition partial (must include category)
}

/** Persist a render override and refresh the cache so the registry rebuilds. */
export function useSaveRenderOverride() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ name, definition }: SaveOverrideArgs) => {
      const res = await fetch(`${API_BASE}/worlds/render-overrides`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, definition }),
      })
      if (!res.ok) throw new Error(`Save failed (${res.status})`)
      return (await res.json()) as RegistryJson
    },
    // The endpoint returns the full doc — seed the cache so useRenderOverrides
    // consumers (the registry) rebuild immediately without a refetch.
    onSuccess: (data) => qc.setQueryData(QUERY_KEY, data),
  })
}

/**
 * Remove a block's override — reverts it to the default (bundled/vanilla)
 * classification and deletes it from authored.json (the file is removed entirely
 * when it was the last override). Refreshes the cache so the registry rebuilds.
 */
export function useRemoveRenderOverride() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (name: string) => {
      const res = await fetch(
        `${API_BASE}/worlds/render-overrides?name=${encodeURIComponent(name)}`,
        { method: 'DELETE' }
      )
      if (!res.ok) throw new Error(`Reset failed (${res.status})`)
      return (await res.json()) as RegistryJson
    },
    onSuccess: (data) => qc.setQueryData(QUERY_KEY, data),
  })
}
