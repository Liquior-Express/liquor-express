'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../lib/api'

// Costos del mismo producto según dónde se compró (Colombia / Brasil).
// Un solo stock: el precio de venta no cambia, solo la utilidad de cada origen.
interface Costo {
  id: string; origen: 'colombia' | 'brasil'; proveedor: string | null; moneda: 'COP' | 'BRL'
  costo_moneda: number; tasa: number | null; costo_cop: number; costos_variables: number
}
export interface ResumenCosto { n: number; costo?: number; costos_variables?: number; margen_pct?: number }

const money = (n: number) => '$' + Math.round(Number(n) || 0).toLocaleString('es-CO')
const vacio = { origen: 'colombia', proveedor: '', moneda: 'COP', costo_moneda: '', tasa: '', costos_variables: '' }

export function CostosOrigen({ productoId, precioVenta, onCambio }: {
  productoId: string; precioVenta: number; onCambio: (r: ResumenCosto) => void
}) {
  const [costos, setCostos] = useState<Costo[]>([])
  const [form, setForm] = useState({ ...vacio })
  const [tasaHoy, setTasaHoy] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    const [c, t] = await Promise.all([
      apiFetch<{ costos: Costo[] }>(`/api/productos/${productoId}/costos`),
      apiFetch<{ tasa: { valor: number } | null }>('/api/tasa'),
    ])
    setCostos(c.costos)
    setTasaHoy(t.tasa ? Number(t.tasa.valor) : null)
    return c.costos.length
  }, [productoId])

  // Al abrir: avisar al formulario cuántos orígenes hay (para bloquear el costo manual).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { cargar().then((n) => onCambio({ n })).catch(() => {}) }, [cargar])

  function elegirOrigen(origen: string) {
    setForm((f) => ({
      ...f, origen,
      moneda: origen === 'brasil' ? 'BRL' : 'COP',
      tasa: origen === 'brasil' && tasaHoy ? String(tasaHoy) : f.tasa,
    }))
  }

  const costoCop = form.moneda === 'BRL'
    ? (Number(form.costo_moneda) || 0) * (Number(form.tasa) || 0)
    : Number(form.costo_moneda) || 0

  async function agregar(e: React.FormEvent) {
    e.preventDefault(); setError(null)
    try {
      const r = await apiFetch<{ resumen: ResumenCosto }>(`/api/productos/${productoId}/costos`, { method: 'POST', body: JSON.stringify(form) })
      setForm({ ...vacio }); await cargar(); onCambio(r.resumen)
    } catch (err: any) { setError(err.message) }
  }
  async function quitar(id: string) {
    try {
      const r = await apiFetch<{ resumen: ResumenCosto }>(`/api/costos/${id}`, { method: 'DELETE' })
      await cargar(); onCambio(r.resumen)
    } catch (err: any) { setError(err.message) }
  }

  return (
    <div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
        {costos.map((c) => {
          const base = Number(c.costo_cop) + Number(c.costos_variables)
          const util = precioVenta - base
          const margen = base > 0 ? Math.round((precioVenta / base - 1) * 100) : 0
          return (
            <div key={c.id} className="row-between" style={{ fontSize: 13, gap: 8 }}>
              <span>
                {c.origen === 'brasil' ? '🇧🇷' : '🇨🇴'} {c.proveedor || (c.origen === 'brasil' ? 'Brasil' : 'Colombia')}
                <span className="faint"> · {c.moneda === 'BRL' ? `R$ ${Number(c.costo_moneda).toLocaleString('es-CO')} × ${money(c.tasa ?? 0)} = ` : ''}{money(c.costo_cop)}{Number(c.costos_variables) ? ` + ${money(c.costos_variables)}` : ''}</span>
              </span>
              <span style={{ display: 'flex', gap: 10, alignItems: 'center', whiteSpace: 'nowrap' }}>
                <span title="Utilidad por unidad" style={{ color: util >= 0 ? 'var(--teal)' : 'var(--copper)', fontWeight: 600 }}>{money(util)} ({margen}%)</span>
                <button type="button" className="link-btn" title="Quitar" onClick={() => quitar(c.id)}>✕</button>
              </span>
            </div>
          )
        })}
        {costos.length === 0 && <span className="faint">Sin costos por origen. Agrégalos si lo compras en Colombia y/o en Brasil.</span>}
        {costos.length > 1 && <span className="faint">El costo del producto es el promedio de los orígenes; el precio de venta no cambia.</span>}
      </div>

      <form onSubmit={agregar} className="form" style={{ marginTop: 0, gap: 10 }}>
        <div className="grid2">
          <div className="field"><label>Origen</label>
            <select value={form.origen} onChange={(e) => elegirOrigen(e.target.value)}>
              <option value="colombia">🇨🇴 Colombia</option>
              <option value="brasil">🇧🇷 Brasil</option>
            </select></div>
          <div className="field"><label>Proveedor</label>
            <input value={form.proveedor} placeholder="opcional" onChange={(e) => setForm({ ...form, proveedor: e.target.value })} /></div>
        </div>
        <div className="grid2">
          <div className="field"><label>Costo en {form.moneda === 'BRL' ? 'Reales (R$)' : 'pesos'}</label>
            <input type="number" inputMode="decimal" step="0.01" value={form.costo_moneda} onChange={(e) => setForm({ ...form, costo_moneda: e.target.value })} required /></div>
          {form.moneda === 'BRL' ? (
            <div className="field"><label>Tasa (pesos por R$)</label>
              <input type="number" inputMode="numeric" value={form.tasa} onChange={(e) => setForm({ ...form, tasa: e.target.value })} required /></div>
          ) : (
            <div className="field"><label>Costos variables</label>
              <input type="number" inputMode="numeric" value={form.costos_variables} onChange={(e) => setForm({ ...form, costos_variables: e.target.value })} /></div>
          )}
        </div>
        {form.moneda === 'BRL' && (
          <div className="grid2">
            <div className="field"><label>Costos variables (pesos)</label>
              <input type="number" inputMode="numeric" value={form.costos_variables} onChange={(e) => setForm({ ...form, costos_variables: e.target.value })} /></div>
            <div className="field"><label>Equivale a</label><input value={money(costoCop)} readOnly /></div>
          </div>
        )}
        {form.origen === 'colombia' && (
          <label className="check" style={{ padding: 0 }}>
            <input type="checkbox" checked={form.moneda === 'BRL'}
              onChange={(e) => setForm({ ...form, moneda: e.target.checked ? 'BRL' : 'COP', tasa: e.target.checked && tasaHoy ? String(tasaHoy) : form.tasa })} />
            Se pagó en Reales
          </label>
        )}
        {error && <div className="alert">{error}</div>}
        <button className="btn" type="submit" style={{ marginTop: 0 }}>＋ Agregar costo</button>
      </form>
    </div>
  )
}
