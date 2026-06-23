import { open } from '@tauri-apps/plugin-dialog'
import { useState } from 'react'

import { validateWorld } from '../api/worlds'
import { addRecentWorld } from '../lib/recentWorlds'

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
      setError(`Could not reach the backend: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <button
        onClick={handlePick}
        disabled={loading}
        className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? 'Validating…' : 'Select World Folder'}
      </button>
      {error && (
        <p className="text-sm text-red-400" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
