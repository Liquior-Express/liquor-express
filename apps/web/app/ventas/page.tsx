'use client'

import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { apiFetch } from '../../lib/api'
import { AppShell, useSesion } from '../../components/AppShell'
import { useDialog } from '../../components/Dialog'
import { CambioEfectivo, PAGO_INICIAL, type PagoEfectivo } from '../../components/CambioEfectivo'
import { encolarVenta, nuevoId } from '../../lib/cola'

interface Producto { id: string; nombre: string; precio_venta: number; existencias: number; foto_url: string | null; activo: boolean; categoria_nombre: string | null }
interface Pres { id: string; producto_id: string; nombre: string; factor_unidades: number; precio: number }
interface Linea { key: string; producto: Producto; pres: Pres | null; cantidad: number }
interface Resumen { cantidad: number; total: number; por_medio: Record<string, number>; utilidad?: number }
type Medio = 'efectivo' | 'nequi' | 'bold' | 'pix'

const money = (n: number) => '$' + Math.round(Number(n) || 0).toLocaleString('es-CO')
const reales = (n: number) => 'R$ ' + (Number(n) || 0).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const MEDIOS: { id: Medio; label: string }[] = [
  { id: 'efectivo', label: '💵 Efectivo' }, { id: 'nequi', label: '📱 Nequi' },
  { id: 'bold', label: '💳 Bold' }, { id: 'pix', label: '🇧🇷 PIX (R$)' },
]
const precioDe = (l: { producto: Producto; pres: Pres | null }) =>
  l.pres ? (Number(l.pres.precio) || l.producto.precio_venta * l.pres.factor_unidades) : l.producto.precio_venta

export default function VentasPage() {
  return <AppShell active="ventas" titulo="Ventas rápidas"><Ventas /></AppShell>
}

function Ventas() {
  const me = useSesion()
  const dialog = useDialog()
  const gestor = me.usuario.rol !== 'cajero'
  const buscarRef = useRef<HTMLInputElement>(null)

  const [productos, setProductos] = useState<Producto[]>([])
  const [pres, setPres] = useState<Pres[]>([])
  const [tasa, setTasa] = useState<{ valor: number; es_de_hoy: boolean } | null>(null)
  const [cajaAbierta, setCajaAbierta] = useState<boolean | null>(null)
  const [resumen, setResumen] = useState<Resumen | null>(null)
  const [buscar, setBuscar] = useState('')
  const [carrito, setCarrito] = useState<Linea[]>([])
  const [medio, setMedio] = useState<Medio>('efectivo')
  const [pago, setPago] = useState<PagoEfectivo>(PAGO_INICIAL)
  const [cobrando, setCobrando] = useState(false)
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null)

  const cargar = useCallback(async () => {
    const [p, pr, t, v, c] = await Promise.all([
      apiFetch<{ productos: Producto[] }>('/api/productos'),
      apiFetch<{ presentaciones: Pres[] }>('/api/presentaciones'),
      apiFetch<{ tasa: { valor: number } | null; es_de_hoy: boolean }>('/api/tasa'),
      apiFetch<{ resumen: Resumen }>('/api/ventas/hoy'),
      apiFetch<{ abierta: boolean }>('/api/caja/actual'),
    ])
    setProductos(p.productos.filter((x) => x.activo))
    setPres(pr.presentaciones)
    setTasa(t.tasa ? { valor: Number(t.tasa.valor), es_de_hoy: t.es_de_hoy } : null)
    setResumen(v.resumen)
    setCajaAbierta(c.abierta)
  }, [])
  useEffect(() => { cargar().catch((e) => setMsg({ tipo: 'error', texto: e.message })) }, [cargar])

  const filtrados = useMemo(() => {
    const q = buscar.trim().toLowerCase()
    return q ? productos.filter((p) => p.nombre.toLowerCase().includes(q) || (p.categoria_nombre ?? '').toLowerCase().includes(q)) : productos
  }, [productos, buscar])

  function agregar(producto: Producto, p: Pres | null) {
    const key = producto.id + ':' + (p?.id ?? 'und')
    setCarrito((c) => {
      const i = c.findIndex((l) => l.key === key)
      if (i >= 0) return c.map((l, j) => (j === i ? { ...l, cantidad: l.cantidad + 1 } : l))
      return [...c, { key, producto, pres: p, cantidad: 1 }]
    })
    setMsg(null)
  }
  function cambiarCantidad(key: string, delta: number) {
    setCarrito((c) => c.map((l) => (l.key === key ? { ...l, cantidad: l.cantidad + delta } : l)).filter((l) => l.cantidad > 0))
  }

  const total = carrito.reduce((s, l) => s + precioDe(l) * l.cantidad, 0)
  const tasaHoy = tasa?.es_de_hoy ? tasa.valor : null
  const necesitaTasa = medio === 'pix' || (medio === 'efectivo' && pago.moneda === 'BRL')

  async function registrarTasa() {
    const v = await dialog.pedir({ title: 'Tasa del Real de hoy', label: 'Pesos por 1 Real (R$)', type: 'number', initial: tasa ? String(tasa.valor) : '', confirmText: 'Guardar' })
    if (!v) return
    try {
      const r = await apiFetch<{ tasa: { valor: number } }>('/api/tasa', { method: 'PUT', body: JSON.stringify({ valor: Number(v) }) })
      setTasa({ valor: Number(r.tasa.valor), es_de_hoy: true })
    } catch (e: any) { setMsg({ tipo: 'error', texto: e.message }) }
  }

  async function cobrar() {
    if (!carrito.length || cobrando) return
    setCobrando(true); setMsg(null)
    // Cada venta lleva un id propio: si se reintenta (o se envía después sin conexión) no se duplica.
    const body = {
      cliente_id: nuevoId(), vendida_en: new Date().toISOString(), medio_pago: medio,
      items: carrito.map((l) => ({ producto_id: l.producto.id, presentacion_id: l.pres?.id ?? null, cantidad: l.cantidad })),
      efectivo: medio === 'efectivo' ? { moneda: pago.moneda, recibido: Number(pago.recibido) || 0, cambio_en: pago.cambioEn } : undefined,
    }
    const limpiar = () => { setCarrito([]); setMedio('efectivo'); setPago(PAGO_INICIAL); setBuscar(''); buscarRef.current?.focus() }
    try {
      const r = await apiFetch<{ venta: { total: number; valor_reales: number | null; cambio: number | null; cambio_en: string | null }; avisos: string[] }>('/api/ventas', {
        method: 'POST', body: JSON.stringify(body),
      })
      const v = r.venta
      const enReales = v.valor_reales ? ` (${reales(Number(v.valor_reales))})` : ''
      const devolver = v.cambio ? ` · Devolver ${v.cambio_en === 'BRL' ? reales(Number(v.cambio)) : money(Number(v.cambio))}` : ''
      setMsg({ tipo: 'ok', texto: `Venta registrada: ${money(v.total)}${enReales}${devolver}` + (r.avisos.length ? ' · ' + r.avisos.join(' · ') : '') })
      limpiar()
      cargar()
    } catch (e: any) {
      if (e?.status === 0) {
        // Sin señal: la venta queda guardada en el equipo y se envía sola al volver la conexión.
        encolarVenta(body)
        setProductos((ps) => ps.map((p) => {
          const u = carrito.filter((l) => l.producto.id === p.id).reduce((s, l) => s + l.cantidad * (l.pres ? l.pres.factor_unidades : 1), 0)
          return u ? { ...p, existencias: p.existencias - u } : p
        }))
        setMsg({ tipo: 'ok', texto: `Sin conexión: venta de ${money(total)} guardada en el equipo; se enviará sola al volver la señal.` })
        limpiar()
      } else setMsg({ tipo: 'error', texto: e.message })
    } finally { setCobrando(false) }
  }

  // Enter en el buscador agrega el primer resultado (útil con lector de código de barras).
  function onBuscarKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && filtrados[0]) { agregar(filtrados[0], null); setBuscar('') }
  }

  return (
    <div className="pos">
      <div>
        <div className="toolbar" style={{ marginTop: 0 }}>
          <input ref={buscarRef} autoFocus className="buscar" placeholder="Buscar producto… (Enter agrega el primero)"
            value={buscar} onChange={(e) => setBuscar(e.target.value)} onKeyDown={onBuscarKey} />
        </div>
        <div className="pos-grid">
          {filtrados.map((p) => {
            const ps = pres.filter((x) => x.producto_id === p.id && Number(x.factor_unidades) > 1).sort((a, b) => a.factor_unidades - b.factor_unidades)
            return (
              <div key={p.id} className="pos-card" onClick={() => agregar(p, null)}>
                {p.foto_url ? <img src={p.foto_url} alt="" /> : <span className="sinfoto">🍾</span>}
                <span className="nom">{p.nombre}</span>
                <span className="pre">{money(p.precio_venta)} <span className="faint" style={{ fontWeight: 400 }}>· {p.existencias} und</span></span>
                {ps.length > 0 && (
                  <span className="pos-chips">
                    {ps.map((x) => (
                      <button key={x.id} type="button" className="pos-chip" onClick={(e) => { e.stopPropagation(); agregar(p, x) }}>
                        {x.nombre} {money(Number(x.precio) || p.precio_venta * x.factor_unidades)}
                      </button>
                    ))}
                  </span>
                )}
              </div>
            )
          })}
          {filtrados.length === 0 && <p className="faint">{productos.length ? 'Sin resultados.' : 'No hay productos activos en el inventario.'}</p>}
        </div>
      </div>

      <aside className="carrito">
        {cajaAbierta === false && (
          <div className="alert" style={{ marginBottom: 12 }}>La caja está cerrada. <a href="/caja"><b>Abrir caja</b></a> para empezar a vender.</div>
        )}
        <div className="row-between">
          <h3 className="sub-modal" style={{ margin: 0 }}>Venta actual</h3>
          {carrito.length > 0 && <button className="link-btn" onClick={() => setCarrito([])}>Vaciar</button>}
        </div>
        <div style={{ marginTop: 8 }}>
          {carrito.map((l) => (
            <div key={l.key} className="linea">
              <span className="n">
                {l.producto.nombre}{l.pres && <span className="faint"> · {l.pres.nombre}</span>}
                <span className="faint" style={{ display: 'block' }}>{money(precioDe(l))} c/u</span>
              </span>
              <span className="qty">
                <button onClick={() => cambiarCantidad(l.key, -1)}>−</button>
                <b>{l.cantidad}</b>
                <button onClick={() => cambiarCantidad(l.key, 1)}>+</button>
              </span>
              <b style={{ minWidth: 72, textAlign: 'right' }}>{money(precioDe(l) * l.cantidad)}</b>
            </div>
          ))}
          {carrito.length === 0 && <p className="faint" style={{ padding: '10px 0' }}>Toca un producto para agregarlo.</p>}
        </div>

        <div className="total-grande">{money(total)}</div>
        {medio === 'pix' && (tasaHoy
          ? <div className="muted">≈ <b>{reales(total / tasaHoy)}</b> <span className="faint">(1 R$ = {money(tasaHoy)})</span></div>
          : <div className="alert" style={{ marginTop: 6 }}>Falta la tasa del Real de hoy.{gestor ? '' : ' Pídele al administrador que la registre.'}</div>
        )}
        {gestor && (
          <button className="link-btn" style={{ marginTop: 8 }} onClick={registrarTasa}>
            🇧🇷 Tasa del Real: {tasa ? money(tasa.valor) + (tasa.es_de_hoy ? ' (hoy)' : ' (desactualizada)') : 'sin registrar'} · cambiar
          </button>
        )}

        <div className="medios">
          {MEDIOS.map((m) => (
            <button key={m.id} className={'medio' + (medio === m.id ? ' activo' : '')} onClick={() => setMedio(m.id)}>{m.label}</button>
          ))}
        </div>
        {medio === 'efectivo' && carrito.length > 0 && <CambioEfectivo total={total} tasa={tasaHoy} valor={pago} onChange={setPago} />}
        {msg && <div className={msg.tipo === 'ok' ? 'aviso-ok' : 'alert'} style={{ marginBottom: 10 }}>{msg.texto}</div>}
        <button className="btn grande" disabled={!carrito.length || cobrando || cajaAbierta === false || (necesitaTasa && !tasaHoy)} onClick={cobrar}>
          {cobrando ? 'Registrando…' : `Cobrar ${money(total)}`}
        </button>

        {resumen && (
          <div className="faint" style={{ marginTop: 14, lineHeight: 1.6 }}>
            Hoy: <b style={{ color: 'var(--text)' }}>{resumen.cantidad}</b> venta(s) · <b style={{ color: 'var(--text)' }}>{money(resumen.total)}</b>
            {resumen.utilidad !== undefined && <> · utilidad {money(resumen.utilidad)}</>}
            {Object.keys(resumen.por_medio).length > 0 && <><br />{Object.entries(resumen.por_medio).map(([k, v]) => `${k}: ${money(v)}`).join(' · ')}</>}
          </div>
        )}
      </aside>
    </div>
  )
}
