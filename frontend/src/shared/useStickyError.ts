import { useEffect, useState } from 'react'

/** The parts of a TanStack query this reads — anything shaped like one fits. */
interface QueryLike {
  isError: boolean
  error: Error | null
  data: unknown
}

/**
 * A query's failure, kept across the refetch that retrying it starts.
 *
 * React Query drops `error` the moment a refetch begins on a query that has no
 * data yet, so a failure screen driven by `isError` alone unmounts itself the
 * instant the user acts on it — falling back to the loading screen it was put
 * there to replace, for as long as the retries take, before reappearing. That
 * makes Retry look like it worked. Latching the error keeps the screen up and
 * lets its button say what is going on instead.
 *
 * Cleared by data arriving, or by `resetKey` changing — a different world or
 * dimension is a different question, and its answer starts blank.
 */
export function useStickyError(q: QueryLike, resetKey: unknown): Error | null {
  const [latched, setLatched] = useState<Error | null>(null)

  useEffect(() => {
    setLatched(null)
  }, [resetKey])

  useEffect(() => {
    if (q.isError && q.error) setLatched(q.error)
    else if (q.data !== undefined) setLatched(null)
  }, [q.isError, q.error, q.data])

  // Data settles it: whatever went wrong before, it is not wrong now. Failing
  // that, this render's own error, and only then the latched one — which is
  // there purely to bridge the gap a refetch opens.
  if (q.data !== undefined) return null
  return q.isError ? q.error : latched
}
