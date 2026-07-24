export const API_BASE = 'http://localhost:8000'

/**
 * A request that came back with no data.
 *
 * `status` carries the distinction the load path turns on. 0 means the request
 * never reached the backend — it is down, or still starting — and so says
 * nothing at all about the world it asked for. Any other status is the
 * backend's own answer about that world.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/** True when the backend never answered, so retrying is the sensible offer. */
export function isUnreachable(error: unknown): boolean {
  // fetch() rejects with a TypeError when it cannot open the connection at
  // all; queries not yet routed through apiFetch still surface that raw.
  return error instanceof ApiError
    ? error.status === 0
    : error instanceof TypeError
}

/**
 * `fetch`, with both failure modes normalised into an ApiError — including
 * FastAPI's `{"detail": …}` body, which is usually the only place that says
 * *why* a world was refused.
 */
export async function apiFetch(
  url: string,
  init?: RequestInit
): Promise<Response> {
  let res: Response
  try {
    res = await fetch(url, init)
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e)
    throw new ApiError(`Could not reach the Atlas backend (${why})`, 0)
  }
  if (!res.ok) throw new ApiError(await failureDetail(res), res.status)
  return res
}

/** The backend's own words when it gave any, the bare status line otherwise. */
async function failureDetail(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { detail?: unknown }
    if (typeof body.detail === 'string' && body.detail) return body.detail
  } catch {
    // Not JSON, or an empty body — the status line is all there is to say.
  }
  return `${res.status} ${res.statusText || 'error'}`
}
