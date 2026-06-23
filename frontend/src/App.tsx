import { useState } from 'react'

import { WorldPicker } from './components/WorldPicker'

export default function App() {
  const [worldPath, setWorldPath] = useState<string | null>(null)

  return (
    <div className="flex h-screen flex-col items-center justify-center gap-4 bg-gray-900 text-white">
      <h1 className="text-2xl font-bold">Atlas GTNH</h1>
      {worldPath ? (
        <p className="text-sm text-gray-400">Loaded: {worldPath}</p>
      ) : (
        <WorldPicker onWorldSelected={setWorldPath} />
      )}
    </div>
  )
}
