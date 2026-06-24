const DB_NAME = 'atlas-gtnh-map'
const STORE = 'chunks'
const VERSION = 1

let dbPromise: Promise<IDBDatabase> | null = null

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION)
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    req.onsuccess = (e) => resolve((e.target as IDBOpenDBRequest).result)
    req.onerror = (e) => reject((e.target as IDBOpenDBRequest).error)
  })
}

function getDB(): Promise<IDBDatabase> {
  if (!dbPromise) dbPromise = openDB()
  return dbPromise
}

export async function loadCachedChunk(
  key: string
): Promise<HTMLCanvasElement | null> {
  try {
    const db = await getDB()
    const raw = await new Promise<unknown>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get(key)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    if (!raw) return null
    // Copy into a fresh ArrayBuffer-backed array to satisfy ImageData constructor types
    const pixels = Uint8ClampedArray.from(
      raw instanceof Uint8ClampedArray
        ? raw
        : new Uint8ClampedArray(raw as ArrayBuffer)
    )
    const canvas = document.createElement('canvas')
    canvas.width = 16
    canvas.height = 16
    canvas.getContext('2d')!.putImageData(new ImageData(pixels, 16, 16), 0, 0)
    return canvas
  } catch {
    return null
  }
}

export async function saveCachedChunk(
  key: string,
  canvas: HTMLCanvasElement
): Promise<void> {
  try {
    const pixels = canvas.getContext('2d')!.getImageData(0, 0, 16, 16).data
    const db = await getDB()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(pixels, key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch {
    // cache errors are non-fatal
  }
}
