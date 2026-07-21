import { open } from '@tauri-apps/plugin-dialog'
import { FolderOpen, Loader2, TriangleAlert } from 'lucide-react'
import { useState } from 'react'

import { validateWorld } from './api/worlds'
import { addRecentWorld } from './recentWorlds'

interface Props {
  onWorldSelected: (path: string) => void
}

export function WorldPicker({ onWorldSelected }: Props) {
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handlePick() {
    const path = await open({ directory: true, multiple: false })
    if (!path) return

    setLoading(true)
    setError(null)

    try {
      const result = await validateWorld(path)
      if (result.valid) {
        addRecentWorld(path)
        onWorldSelected(path)
      } else {
        setError(result.error ?? 'Invalid world folder')
      }
    } catch (e) {
      console.error('World validation error:', e)
      setError(
        `Could not reach the backend: ${e instanceof Error ? e.message : String(e)}`
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <button
        onClick={handlePick}
        disabled={loading}
        // Dark label, not white: the accent is a bright green, so white sits at
        // 1.9:1 against it while this is 9.7:1.
        className="inline-flex items-center gap-2.5 rounded-lg bg-atlas-accent px-5 py-2.5 text-sm font-semibold text-[#0b1512] transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <FolderOpen className="h-4 w-4" aria-hidden />
        )}
        {loading ? 'Validating…' : 'Select World Folder'}
      </button>
      {error && (
        <p
          className="inline-flex items-center gap-1.5 text-sm text-atlas-danger"
          role="alert"
        >
          <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden />
          {error}
        </p>
      )}
    </div>
  )
}
