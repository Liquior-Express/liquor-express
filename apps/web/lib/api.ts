// Sesión guardada en el navegador (terminal único del estanco).
const KEY = 'le_token'

export const guardarToken = (t: string) => { try { localStorage.setItem(KEY, t) } catch {} }
export const leerToken = (): string | null => { try { return localStorage.getItem(KEY) } catch { return null } }
export const borrarToken = () => { try { localStorage.removeItem(KEY) } catch {} }

// Llama al backend (/api/...) adjuntando el token de sesión si existe.
export async function apiFetch<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('Content-Type', 'application/json')
  const t = leerToken()
  if (t) headers.set('Authorization', `Bearer ${t}`)

  let res: Response
  try {
    res = await fetch(path, { ...init, headers })
  } catch {
    // Sin red o servidor caído: mensaje claro en vez de "Failed to fetch".
    const err = new Error('Sin conexión con el servidor. Revisa el internet e intenta de nuevo.') as Error & { status?: number }
    err.status = 0
    throw err
  }
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(json?.error ?? `Error ${res.status}`) as Error & { status?: number }
    err.status = res.status
    throw err
  }
  return json as T
}
