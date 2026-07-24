import { QueryClient } from '@tanstack/react-query'

/**
 * The app's one QueryClient.
 *
 * `networkMode: 'always'` is the whole reason this is not just `new
 * QueryClient()`. Atlas only ever talks to its own backend on localhost, so the
 * browser's idea of being "online" has nothing to do with whether that backend
 * can be reached — and playing Minecraft with the wifi off is entirely normal.
 * Under the default mode, a query started while the browser reports offline
 * never runs its fetch at all: it parks in `fetchStatus: 'paused'` and stays
 * `pending`, so it reports neither data nor error and the load path waits on a
 * spinner that cannot resolve. That would swallow the very failures the screens
 * below it exist to show.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { networkMode: 'always' },
      mutations: { networkMode: 'always' },
    },
  })
}
