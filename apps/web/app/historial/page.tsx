'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../../lib/api'
import { AppShell, useSesion } from '../../components/AppShell'
import { Modal } from '../../components/Modal'
import { useDialog } from '../../components/Dialog'

interface VentaFila { id: string; total: number; utilidad?: number; medio_pago: string; valor_reales: number | null; moneda_efectivo: string | null; estado: string; creado_en: string; vendida_en: string | null; usuario_nombre: string | null }
interface Resumen { cantidad: number; total: number; anuladas: number; utilidad?: number }
interface Detalle {
  venta: VentaFila & { cambio: number | null; cambio_en: string | null; efectivo_recibido: number | null; motivo_anulacion: string | null; sesion_abierta: boolean }
  items: { id: string; producto_nombre: string; presentacion: string | null; cantidad: number; precio_unitario: number }[]
}

const money = (n: number) => '$' + Math.round(Number(n) || 0).toLocaleString('es-CO')
const reales = (n: number) => 'R$ ' + (Number(n) || 0).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const hoyLocal = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' })
const fechaHora = (s: string) => new Date(s).toLocaleString('es-CO', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const MEDIO: Record<string, string> = { efectivo: '💵 Efectivo', nequi: '📱 Nequi', bold: '💳 Bold', pix: '🇧🇷 PIX' }

export default function HistorialPage() {
  return <AppShell active="historial" titulo="Historial de ventas"><Historial /></AppShell>
}

function Historial() {
  const me = useSesion()
  const dialog = useDialog()
  const gestor = me.usuario.rol !== 'cajero'

  const [f, setF] = useState({ desde: hoyLocal(), hasta: hoyLocal(), medio: '', estado: '' })
  const [ventas, setVentas] = useState<VentaFila[]>([])
  const [resumen, setResumen] = useState<Resumen | null>(null)
  const [detalle, setDetalle] = useState<Detalle | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]).toString()
    const r = await apiFetch<{ ventas: VentaFila[]; resumen: Resumen }>(`/api/ventas?${q}`)
    setVentas(r.ventas); setResumen(r.resumen)
  }, [f])
  useEffect(() => { cargar().catch((e) => setMsg(e.message)) }, [cargar])

  async function abrir(id: string) {
    try { setDetalle(await apiFetch<Detalle>(`/api/ventas/${id}`)) } catch (e: any) { setMsg(e.message) }
  }
  async function anular() {
    if (!detalle) return
    const motivo = await dialog.pedir({ title: 'Anular venta', label: 'Motivo', placeholder: 'p. ej. Error al cobrar', confirmText: 'Anular venta' })
    if (!motivo) return
    try {
      await apiFetch(`/api/ventas/${detalle.venta.id}/anular`, { method: 'POST', body: JSON.stringify({ motivo }) })
      setDetalle(null); setMsg(null); cargar()
    } catch (e: any) { setMsg(e.message) }
  }

  const v = detalle?.venta
  return (
    <>
      <div className="toolbar" style={{ marginTop: 0 }}>
        <input type="date" className="celda" style={{ width: 150 }} value={f.desde} onChange={(e) => setF({ ...f, desde: e.target.value })} />
        <span className="faint">a</span>
        <input type="date" className="celda" style={{ width: 150 }} value={f.hasta} onChange={(e) => setF({ ...f, hasta: e.target.value })} />
        <select className="celda" style={{ width: 150 }} value={f.medio} onChange={(e) => setF({ ...f, medio: e.target.value })}>
          <option value="">Todos los medios</option>
          {Object.entries(MEDIO).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select className="celda" style={{ width: 140 }} value={f.estado} onChange={(e) => setF({ ...f, estado: e.target.value })}>
          <option value="">Activas y anuladas</option><option value="activa">Solo activas</option><option value="anulada">Solo anuladas</option>
        </select>
      </div>
      {msg && <div className="alert" style={{ marginBottom: 12 }}>{msg}</div>}

      {resumen && (
        <div className="tiles" style={{ marginTop: 0 }}>
          <div className="tile"><div className="t">Ventas</div><div className="v">{resumen.cantidad}</div></div>
          <div className="tile"><div className="t">Total vendido</div><div className="v">{money(resumen.total)}</div></div>
          {resumen.utilidad !== undefined && <div className="tile"><div className="t">Utilidad</div><div className="v">{money(resumen.utilidad)}</div></div>}
          <div className="tile"><div className="t">Anuladas</div><div className="v">{resumen.anuladas}</div></div>
        </div>
      )}

      <div className="tabla-wrap">
        <table className="tabla">
          <thead><tr><th>Fecha</th><th>Medio</th><th className="num">Total</th>{gestor && <th className="num">Utilidad</th>}<th>Vendió</th><th>Estado</th></tr></thead>
          <tbody>
            {ventas.map((x) => (
              <tr key={x.id} className={x.estado === 'anulada' ? 'inactivo' : ''} onClick={() => abrir(x.id)}>
                <td>{fechaHora(x.vendida_en ?? x.creado_en)}</td>
                <td>{MEDIO[x.medio_pago] ?? x.medio_pago}{x.moneda_efectivo === 'BRL' && <span className="faint"> (reales)</span>}</td>
                <td className="num">{money(x.total)}{x.valor_reales ? <span className="desglose">{reales(x.valor_reales)}</span> : null}</td>
                {gestor && <td className="num">{x.utilidad !== undefined ? money(x.utilidad) : '—'}</td>}
                <td>{x.usuario_nombre ?? '—'}</td>
                <td>{x.estado === 'anulada' ? <span className="chip warn">Anulada</span> : <span className="faint">Activa</span>}</td>
              </tr>
            ))}
            {ventas.length === 0 && <tr><td colSpan={gestor ? 6 : 5} style={{ textAlign: 'center', color: 'var(--faint)', padding: 24 }}>No hay ventas en este periodo.</td></tr>}
          </tbody>
        </table>
      </div>

      <Modal open={!!detalle} title="Detalle de venta" onClose={() => setDetalle(null)} ancho={520}>
        {v && detalle && (
          <div>
            <p className="muted">{fechaHora(v.vendida_en ?? v.creado_en)} · {MEDIO[v.medio_pago]} · vendió {v.usuario_nombre ?? '—'}</p>
            <div style={{ margin: '12px 0' }}>
              {detalle.items.map((i) => (
                <div key={i.id} className="linea">
                  <span className="n">{i.producto_nombre}{i.presentacion && <span className="faint"> · {i.presentacion}</span>}</span>
                  <span className="faint">{i.cantidad} × {money(i.precio_unitario)}</span>
                  <b style={{ minWidth: 80, textAlign: 'right' }}>{money(i.precio_unitario * i.cantidad)}</b>
                </div>
              ))}
            </div>
            <div className="row-between"><span className="muted">Total</span><b style={{ fontSize: 20 }}>{money(v.total)}</b></div>
            {v.valor_reales && <div className="row-between faint"><span>En reales</span><span>{reales(v.valor_reales)}</span></div>}
            {v.efectivo_recibido && <div className="row-between faint"><span>Recibido</span><span>{v.moneda_efectivo === 'BRL' ? reales(v.efectivo_recibido) : money(v.efectivo_recibido)}</span></div>}
            {v.cambio ? <div className="row-between faint"><span>Cambio</span><span>{v.cambio_en === 'BRL' ? reales(v.cambio) : money(v.cambio)}</span></div> : null}
            {v.utilidad !== undefined && <div className="row-between faint"><span>Utilidad</span><span>{money(v.utilidad)}</span></div>}

            {v.estado === 'anulada' ? (
              <div className="alert" style={{ marginTop: 14 }}>Anulada{v.motivo_anulacion ? `: ${v.motivo_anulacion}` : ''}</div>
            ) : gestor && (
              v.sesion_abierta
                ? <button className="btn peligro" style={{ width: '100%', marginTop: 16 }} onClick={anular}>Anular venta</button>
                : <p className="faint" style={{ marginTop: 14 }}>Solo se pueden anular ventas de la caja abierta (antes del cierre).</p>
            )}
          </div>
        )}
      </Modal>
    </>
  )
}
