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

  const res = await fetch(path, { ...init, headers })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json?.error ?? `Error ${res.status}`)
  return json as T
}
