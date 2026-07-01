const STORAGE_KEY = 'atlas-gtnh:recent-worlds'
const MAX_RECENT = 5

export function getRecentWorlds(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as string[]) : []
  } catch {
    return []
  }
}

export function addRecentWorld(path: string): void {
  const updated = [path, ...getRecentWorlds().filter((p) => p !== path)].slice(
    0,
    MAX_RECENT
  )
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
}
