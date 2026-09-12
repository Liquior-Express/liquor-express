'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '../lib/api'

// Productos por pedir: los que llegaron al mínimo y los que están por llegar.
// Se puede descargar en PDF para llevarlo al proveedor.
interface Fila {
  id: string; nombre: string; categoria: string; unidad: string
  existencias: number; stock_min: number; faltan: number; vendidas30: number; dias_restantes: number | null
}
interface Datos { hoy: string; bajos: Fila[]; proximos: Fila[] }

export function StockBajo() {
  const [d, setD] = useState<Datos | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [bajando, setBajando] = useState(false)

  useEffect(() => { apiFetch<Datos>('/api/reportes/stock').then(setD).catch((e) => setError(e.message)) }, [])

  async function descargarPdf() {
    setBajando(true); setError(null)
    try {
      const r = await fetch('/api/reportes/stock.pdf', { headers: { Authorization: `Bearer ${localStorage.getItem('le_token') ?? ''}` } })
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error ?? 'No se pudo generar el PDF')
      const url = URL.createObjectURL(await r.blob())
      const a = document.createElement('a')
      a.href = url
      a.download = `productos-por-pedir-${d?.hoy ?? ''}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e: any) { setError(e.message ?? 'No se pudo generar el PDF') } finally { setBajando(false) }
  }

  const tabla = (filas: Fila[], vacio: string) => (
    <div className="tabla-wrap">
      <table className="tabla" style={{ minWidth: 0 }}>
        <thead><tr>
          <th>Producto</th><th className="num">Existencias</th><th className="num">Mínimo</th>
          <th className="num">Faltan</th><th className="num">Vend. 30 d</th><th className="num">Alcanza</th>
        </tr></thead>
        <tbody>
          {filas.map((f) => (
            <tr key={f.id} style={{ cursor: 'default' }}>
              <td>{f.nombre}{f.categoria && <span className="faint"> · {f.categoria}</span>}</td>
              <td className="num"><b className={f.existencias <= 0 ? 'dif-mal' : ''}>{f.existencias} {f.unidad}</b></td>
              <td className="num">{f.stock_min}</td>
              <td className="num">{f.faltan > 0 ? f.faltan : '—'}</td>
              <td className="num">{f.vendidas30}</td>
              <td className="num">{f.dias_restantes === null ? '—' : f.dias_restantes <= 3 ? <span className="dif-mal">{f.dias_restantes} día(s)</span> : `${f.dias_restantes} días`}</td>
            </tr>
          ))}
          {filas.length === 0 && <tr><td colSpan={6} className="faint" style={{ textAlign: 'center', padding: 16 }}>{vacio}</td></tr>}
        </tbody>
      </table>
    </div>
  )

  return (
    <div className="seccion-rep">
      <div className="row-between" style={{ flexWrap: 'wrap', gap: 10, marginBottom: 10 }}>
        <h3 style={{ margin: 0 }}>Productos por pedir</h3>
        <button className="btn ghost no-imprimir" style={{ marginTop: 0 }} onClick={descargarPdf} disabled={bajando || !d}>
          {bajando ? 'Generando…' : '⬇ Descargar PDF'}
        </button>
      </div>
      {error && <div className="alert" style={{ marginBottom: 10 }}>{error}</div>}
      {!d ? <p className="faint">Cargando…</p> : (
        <>
          <h4 className="sub-modal">Ya llegaron al mínimo ({d.bajos.length})</h4>
          {tabla(d.bajos, 'Ninguno. Todo por encima del mínimo. 👌')}
          <h4 className="sub-modal" style={{ marginTop: 16 }}>Próximos a llegar al mínimo ({d.proximos.length})</h4>
          {tabla(d.proximos, 'Ninguno por ahora.')}
          <p className="faint" style={{ marginTop: 8 }}>
            Solo productos con alerta de stock configurada. "Próximos" = hasta un 50% por encima de su mínimo.
            "Alcanza" = días que duran las existencias al ritmo de venta de los últimos 30 días.
          </p>
        </>
      )}
    </div>
  )
}
