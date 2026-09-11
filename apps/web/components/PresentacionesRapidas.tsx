'use client'

import { useState } from 'react'
import { apiFetch } from '../lib/api'

// Plantillas de presentaciones (cigarrillos y cervezas) y entrada de mercancía
// por presentación: ej. 5 × Caja → suma 150 unidades al inventario.
interface Pres { id: string; nombre: string; factor_unidades: number; precio: number }

const PLANTILLAS: Record<string, { label: string; items: { nombre: string; factor: number }[] }> = {
  cigarrillo: { label: '🚬 Cigarrillos', items: [{ nombre: 'Cajetilla', factor: 20 }, { nombre: 'Media cajetilla', factor: 10 }] },
  cerveza: { label: '🍺 Cervezas', items: [{ nombre: 'Caja', factor: 30 }, { nombre: 'Six pack', factor: 6 }] },
}

export function PresentacionesRapidas({ productoId, precioUnidad, presentaciones, setPresentaciones, onExistencias }: {
  productoId: string
  precioUnidad: number
  presentaciones: Pres[]
  setPresentaciones: (p: Pres[]) => void
  onExistencias: (n: number) => void
}) {
  const [entrada, setEntrada] = useState({ pres: 'und', cantidad: '' })
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null)
  const [ocupado, setOcupado] = useState(false)

  async function aplicar(clave: string) {
    setOcupado(true); setMsg(null)
    try {
      const nuevas: Pres[] = []
      for (const it of PLANTILLAS[clave].items) {
        if (presentaciones.some((p) => p.nombre.toLowerCase() === it.nombre.toLowerCase())) continue
        const r = await apiFetch<{ presentacion: Pres }>(`/api/productos/${productoId}/presentaciones`, {
          method: 'POST',
          body: JSON.stringify({ nombre: it.nombre, factor_unidades: it.factor, precio: Math.round(precioUnidad * it.factor) }),
        })
        nuevas.push(r.presentacion)
      }
      setPresentaciones([...presentaciones, ...nuevas].sort((a, b) => b.factor_unidades - a.factor_unidades))
      setMsg({ ok: true, texto: nuevas.length ? `Agregadas: ${nuevas.map((n) => n.nombre).join(', ')}. Ajusta unidades o precio si tu producto es distinto.` : 'Ya tenía esas presentaciones.' })
    } catch (e: any) { setMsg({ ok: false, texto: e.message }) } finally { setOcupado(false) }
  }

  const presSel = presentaciones.find((p) => p.id === entrada.pres)
  const factor = presSel ? Number(presSel.factor_unidades) : 1
  const unidades = (Number(entrada.cantidad) || 0) * factor

  async function registrarEntrada(e: React.FormEvent) {
    e.preventDefault()
    if (!(unidades > 0)) return
    setOcupado(true); setMsg(null)
    const nombre = presSel ? presSel.nombre : 'und'
    try {
      const r = await apiFetch<{ existencias: number }>(`/api/productos/${productoId}/entrada`, {
        method: 'POST', body: JSON.stringify({ unidades, referencia: `${entrada.cantidad}× ${nombre}` }),
      })
      onExistencias(r.existencias)
      setMsg({ ok: true, texto: `Entrada: +${unidades} und (${entrada.cantidad}× ${nombre}). Existencias: ${r.existencias}` })
      setEntrada({ ...entrada, cantidad: '' })
    } catch (e: any) { setMsg({ ok: false, texto: e.message }) } finally { setOcupado(false) }
  }

  return (
    <div style={{ marginTop: 12 }}>
      <div className="faint" style={{ marginBottom: 6 }}>Plantillas rápidas:</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {Object.entries(PLANTILLAS).map(([k, v]) => (
          <button key={k} type="button" className="pos-chip" disabled={ocupado} onClick={() => aplicar(k)}>
            {v.label} · {v.items.map((i) => `${i.nombre} ${i.factor}`).join(' / ')}
          </button>
        ))}
      </div>

      <h4 className="sub-modal" style={{ marginTop: 16 }}>Entrada de mercancía por presentación</h4>
      <form onSubmit={registrarEntrada} style={{ display: 'grid', gridTemplateColumns: '90px 1fr auto', gap: 8, alignItems: 'end' }}>
        <div className="field"><label>Cantidad</label>
          <input type="number" inputMode="numeric" value={entrada.cantidad} onChange={(e) => setEntrada({ ...entrada, cantidad: e.target.value })} required /></div>
        <div className="field"><label>Presentación</label>
          <select value={entrada.pres} onChange={(e) => setEntrada({ ...entrada, pres: e.target.value })}>
            <option value="und">Unidad</option>
            {presentaciones.map((p) => <option key={p.id} value={p.id}>{p.nombre} ({p.factor_unidades} und)</option>)}
          </select></div>
        <button className="btn" type="submit" disabled={ocupado} style={{ marginTop: 0, padding: '0 14px', height: 42 }}>Sumar</button>
      </form>
      {unidades > 0 && <div className="sugerido">= +{unidades} unidades al inventario</div>}
      {msg && <div className={msg.ok ? 'aviso-ok' : 'alert'} style={{ marginTop: 8 }}>{msg.texto}</div>}
    </div>
  )
}
