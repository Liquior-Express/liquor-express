import { apiFetch } from './api'

// Ventas hechas sin conexión: se guardan en el equipo (terminal único) y se envían
// solas al volver la señal. Cada venta lleva un id propio, así el servidor no la duplica.
const KEY = 'le_cola_ventas'

export interface VentaEnCola { cliente_id: string; body: any; creada: string; error?: string }

export const nuevoId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`

export const leerCola = (): VentaEnCola[] => {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]') } catch { return [] }
}
function guardar(cola: VentaEnCola[]) {
  try { localStorage.setItem(KEY, JSON.stringify(cola)) } catch {}
  window.dispatchEvent(new Event('le-cola'))
}

export function encolarVenta(body: any) {
  guardar([...leerCola(), { cliente_id: body.cliente_id, body, creada: new Date().toISOString() }])
}

let enCurso = false
export async function sincronizarCola(): Promise<{ enviadas: number; pendientes: number }> {
  if (enCurso) return { enviadas: 0, pendientes: leerCola().length }
  enCurso = true
  let enviadas = 0
  try {
    let cola = leerCola()
    for (const item of [...cola]) {
      try {
        await apiFetch('/api/ventas', { method: 'POST', body: JSON.stringify(item.body) })
        cola = cola.filter((x) => x.cliente_id !== item.cliente_id)
        enviadas++
      } catch (e: any) {
        if (e?.status === 0 || e?.status === 503) break // sigue sin conexión: se intenta más tarde
        cola = cola.map((x) => (x.cliente_id === item.cliente_id ? { ...x, error: e?.message } : x)) // p. ej. caja cerrada
      }
      guardar(cola)
    }
    return { enviadas, pendientes: cola.length }
  } finally {
    enCurso = false
  }
}
