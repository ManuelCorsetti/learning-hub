import { useCallback, useEffect, useRef, useState } from 'react'

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(data.error ?? `Request failed (${res.status})`, res.status)
  return data as T
}

const CHANGED = 'learning-studio:changed'

/** Tells every mounted useApi hook to refetch. Call after any change. */
export const notifyChanged = () => window.dispatchEvent(new Event(CHANGED))

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: async <T>(path: string, body: unknown = {}) => {
    const result = await request<T>('POST', path, body)
    notifyChanged()
    return result
  },
  patch: async <T>(path: string, body: unknown) => {
    const result = await request<T>('PATCH', path, body)
    notifyChanged()
    return result
  },
  del: async <T>(path: string) => {
    const result = await request<T>('DELETE', path)
    notifyChanged()
    return result
  },
}

export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(path !== null)
  const latest = useRef(path)
  latest.current = path

  const reload = useCallback(async () => {
    if (path === null) return
    setLoading(true)
    try {
      const result = await api.get<T>(path)
      if (latest.current === path) {
        setData(result)
        setError(null)
      }
    } catch (err) {
      if (latest.current === path) setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (latest.current === path) setLoading(false)
    }
  }, [path])

  useEffect(() => {
    setData(null)
    void reload()
    const onChange = () => void reload()
    window.addEventListener(CHANGED, onChange)
    return () => window.removeEventListener(CHANGED, onChange)
  }, [reload])

  return { data, error, loading, reload }
}

/** Runs an async action with a busy flag and a user-readable error. */
export function useAction() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = useCallback(async <R>(action: () => Promise<R>): Promise<R | undefined> => {
    setBusy(true)
    setError(null)
    try {
      return await action()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return undefined
    } finally {
      setBusy(false)
    }
  }, [])
  return { busy, error, run, setError }
}
