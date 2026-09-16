'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../lib/api'
import { Modal } from './Modal'
import { useDialog } from './Dialog'
import { documento } from './Clientes'

// Ventas de la caja abierta, desde Ventas rápidas: ver cada una y corregirla (vuelve al carrito) o
// borrarla si se registró por error. Borrar la anula: devuelve los productos al inventario y queda
// en el historial con el motivo.

export interface DetalleVenta {
  venta: {
    id: string; total: number; medio_pago: string; valor_reales: number | null; moneda_efectivo: string | null
    efectivo_recibido: number | null; cambio: number | null; cambio_en: string | null; estado: string
    motivo_anulacion: string | null; creado_en: string; vendida_en: string | null; usuario_nombre: string | null
    comprador: { id: string; nombre: string; tipo_documento: string; numero_documento: string; dv: string | null } | null
    puede_corregir: boolean
  }
  items: { id: string; producto_id: string; producto_nombre: string; presentacion: string | null; cantidad: number; precio_unitario: number }[]
  pagos: { medio: string; moneda: string; monto: number; valor_pesos: number }[]
}
interface Fila {
  id: string; total: number; medio_pago: string; estado: string; creado_en: string; vendida_en: string | null
  usuario_nombre: string | null; comprador_nombre: string | null; puede_corregir: boolean
  items: { cantidad: number; presentacion: string | null; producto_nombre: string }[]
}

const money = (n: number) => '$' + Math.round(Number(n) || 0).toLocaleString('es-CO')
const reales = (n: number) => 'R$ ' + (Number(n) || 0).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const hora = (s: string) => new Date(s).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })
export const MEDIO_LABEL: Record<string, string> = { efectivo: '💵 Efectivo', nequi: '📱 Nequi', bold: '💳 Bold', pix: '💠 PIX', mixto: '➗ Dividido' }
export const parteLabel = (p: { medio: string; moneda: string; monto: number }) =>
  `${MEDIO_LABEL[p.medio] ?? p.medio}${p.medio === 'efectivo' ? (p.moneda === 'BRL' ? ' reales' : ' pesos') : ''}: ${p.moneda === 'BRL' ? reales(p.monto) : money(p.monto)}`

export function VentasCaja({ open, onClose, onCorregir, onCambio }: {
  open: boolean; onClose: () => void; onCorregir: (d: DetalleVenta) => void; onCambio: () => void
}) {
  const dialog = useDialog()
  const [filas, setFilas] = useState<Fila[] | null>(null)
  const [abierta, setAbierta] = useState(true)
  const [detalle, setDetalle] = useState<DetalleVenta | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    try {
      const r = await apiFetch<{ abierta: boolean; ventas: Fila[] }>('/api/ventas/caja')
      setFilas(r.ventas); setAbierta(r.abierta); setMsg(null)
    } catch (e: any) { setMsg(e.message) }
  }, [])
  useEffect(() => { if (open) { setDetalle(null); setFilas(null); cargar() } }, [open, cargar])

  async function ver(id: string) {
    try { setDetalle(await apiFetch<DetalleVenta>(`/api/ventas/${id}`)); setMsg(null) } catch (e: any) { setMsg(e.message) }
  }
  async function borrar() {
    if (!detalle) return
    const motivo = await dialog.pedir({
      title: 'Borrar venta', label: '¿Por qué se borra?', placeholder: 'p. ej. Se registró dos veces', confirmText: 'Borrar venta',
    })
    if (!motivo) return
    try {
      await apiFetch(`/api/ventas/${detalle.venta.id}/anular`, { method: 'POST', body: JSON.stringify({ motivo }) })
      setDetalle(null); cargar(); onCambio()
    } catch (e: any) { setMsg(e.message) }
  }

  const v = detalle?.venta
  const activas = (filas ?? []).filter((f) => f.estado === 'activa')
  return (
    <Modal open={open} title={detalle ? 'Venta de las ' + hora(v!.vendida_en ?? v!.creado_en) : 'Ventas de la caja abierta'} onClose={onClose} ancho={560}>
      {msg && <div className="alert" style={{ marginBottom: 10 }}>{msg}</div>}
      {detalle && v ? (
        <div>
          <button type="button" className="link-btn" style={{ marginBottom: 8 }} onClick={() => setDetalle(null)}>← Volver a la lista</button>
          <p className="muted" style={{ margin: 0 }}>
            {MEDIO_LABEL[v.medio_pago] ?? v.medio_pago} · vendió {v.usuario_nombre ?? '—'}
            {v.comprador ? <> · cliente <b>{v.comprador.nombre}</b> ({documento(v.comprador)})</> : ' · consumidor final'}
          </p>
          <div style={{ margin: '12px 0' }}>
            {detalle.items.map((i) => (
              <div key={i.id} className="linea">
                <span className="n">{i.producto_nombre}{i.presentacion && <span className="faint"> · {i.presentacion}</span>}</span>
                <span className="faint">{Number(i.cantidad)} × {money(i.precio_unitario)}</span>
                <b style={{ minWidth: 80, textAlign: 'right' }}>{money(i.precio_unitario * i.cantidad)}</b>
              </div>
            ))}
          </div>
          <div className="row-between"><span className="muted">Total</span><b style={{ fontSize: 20 }}>{money(v.total)}</b></div>
          {detalle.pagos.map((p, n) => <div key={n} className="row-between faint"><span>{parteLabel(p)}</span></div>)}
          {v.cambio ? <div className="row-between faint"><span>Cambio</span><span>{v.cambio_en === 'BRL' ? reales(v.cambio) : money(v.cambio)}</span></div> : null}

          {v.estado === 'anulada' ? (
            <div className="alert" style={{ marginTop: 14 }}>Borrada{v.motivo_anulacion ? `: ${v.motivo_anulacion}` : ''}</div>
          ) : v.puede_corregir ? (
            <div className="grid-2col" style={{ marginTop: 16, gap: 10 }}>
              <button className="btn" style={{ marginTop: 0 }} onClick={() => onCorregir(detalle)}>✏️ Corregir productos o pago</button>
              <button className="btn peligro" style={{ marginTop: 0 }} onClick={borrar}>🗑 Borrar venta</button>
            </div>
          ) : (
            <p className="faint" style={{ marginTop: 14 }}>Solo quien hizo la venta, administración o gerencia pueden cambiarla.</p>
          )}
          {v.puede_corregir && (
            <p className="faint" style={{ marginTop: 10, lineHeight: 1.5 }}>
              Al corregir, la venta vuelve al carrito; cuando la guardes, la anterior queda anulada y el inventario se ajusta solo.
            </p>
          )}
        </div>
      ) : (
        <div>
          {!abierta && <p className="faint">La caja está cerrada: no hay ventas para corregir. Las de días anteriores están en Historial de ventas.</p>}
          {filas && abierta && (
            <p className="faint" style={{ marginTop: 0 }}>{activas.length} venta(s) · {money(activas.reduce((s, f) => s + Number(f.total), 0))}. Toca una para verla, corregirla o borrarla.</p>
          )}
          {!filas && !msg && <p className="faint">Cargando…</p>}
          <div className="ventas-caja">
            {(filas ?? []).map((f) => (
              <button key={f.id} type="button" className={'venta-fila' + (f.estado === 'anulada' ? ' anulada' : '')} onClick={() => ver(f.id)}>
                <span className="venta-fila-cab">
                  <b>{hora(f.vendida_en ?? f.creado_en)}</b>
                  <span className="faint">{MEDIO_LABEL[f.medio_pago] ?? f.medio_pago}</span>
                  {f.estado === 'anulada' && <span className="chip warn">Borrada</span>}
                  <b className="venta-fila-total">{money(f.total)}</b>
                </span>
                <span className="faint venta-fila-items">
                  {f.items.map((i) => `${i.cantidad}× ${i.producto_nombre}${i.presentacion ? ' ' + i.presentacion.toLowerCase() : ''}`).join(' · ')}
                </span>
                {(f.comprador_nombre || f.usuario_nombre) && (
                  <span className="faint">{f.comprador_nombre ? '👤 ' + f.comprador_nombre + ' · ' : ''}{f.usuario_nombre ? 'vendió ' + f.usuario_nombre : ''}</span>
                )}
              </button>
            ))}
            {filas && abierta && filas.length === 0 && <p className="faint">Todavía no hay ventas en esta caja.</p>}
          </div>
        </div>
      )}
    </Modal>
  )
}
