'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { apiFetch } from '../../lib/api'
import { nuevoId } from '../../lib/cola'
import { AppShell, useSesion } from '../../components/AppShell'
import { Modal } from '../../components/Modal'
import { useDialog } from '../../components/Dialog'

interface Proveedor { id: string; nombre: string; contacto: string | null; nit: string | null; origen: 'colombia' | 'brasil'; activo: boolean }
interface Producto { id: string; nombre: string; precio_venta: number; margen_pct?: number; controla_vencimiento: boolean; existencias: number; activo: boolean }
interface Pres { id: string; producto_id: string; nombre: string; factor_unidades: number }
interface Linea { key: string; producto: Producto; presentacion_id: string; cantidad: string; valor_unitario: string; fecha_vencimiento: string; margen_pct: string; precio_venta: string }
interface CompraFila { id: string; fecha: string; factura: string | null; total: number; forma_pago: string; estado_pago: string; proveedor_nombre: string | null; moneda: string; origen: string }

const money = (n: number) => '$' + Math.round(Number(n) || 0).toLocaleString('es-CO')
const reales = (n: number) => 'R$ ' + (Number(n) || 0).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const hoyLocal = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' })
const FORMAS = [
  { id: 'transferencia', label: 'Transferencia' },
  { id: 'efectivo_caja', label: 'Efectivo de la caja' },
  { id: 'credito', label: 'A crédito' },
]
const FORMA_LABEL: Record<string, string> = { transferencia: 'Transferencia', efectivo_caja: 'Efectivo de caja', credito: 'Crédito' }
const TABS = [
  { id: 'nueva', label: 'Nueva compra' }, { id: 'historial', label: 'Historial' },
  { id: 'pagar', label: 'Por pagar' }, { id: 'proveedores', label: 'Proveedores' },
] as const
type Tab = typeof TABS[number]['id']

const cabeceraVacia = () => ({ proveedor_id: '', factura: '', fecha: hoyLocal(), origen: 'colombia', moneda: 'COP', tasa: '', costos_variables: '', forma_pago: 'transferencia', notas: '' })

export default function ComprasPage() {
  return <AppShell active="compras" titulo="Compras"><Compras /></AppShell>
}

function Compras() {
  const me = useSesion()
  const router = useRouter()
  const dialog = useDialog()
  useEffect(() => { if (me.usuario.rol === 'cajero') router.replace('/ventas') }, [me, router])

  const [tab, setTab] = useState<Tab>('nueva')
  const [proveedores, setProveedores] = useState<Proveedor[]>([])
  const [productos, setProductos] = useState<Producto[]>([])
  const [pres, setPres] = useState<Pres[]>([])
  const [compras, setCompras] = useState<CompraFila[]>([])
  const [detalle, setDetalle] = useState<any>(null)
  const [cab, setCab] = useState(cabeceraVacia())
  const [lineas, setLineas] = useState<Linea[]>([])
  const [buscar, setBuscar] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [provForm, setProvForm] = useState({ nombre: '', contacto: '', nit: '', origen: 'colombia' })

  const cargar = useCallback(async () => {
    const [pv, p, pr, c, t] = await Promise.all([
      apiFetch<{ proveedores: Proveedor[] }>('/api/proveedores'),
      apiFetch<{ productos: Producto[] }>('/api/productos'),
      apiFetch<{ presentaciones: Pres[] }>('/api/presentaciones'),
      apiFetch<{ compras: CompraFila[] }>('/api/compras'),
      apiFetch<{ tasa: { valor: number } | null }>('/api/tasa'),
    ])
    setProveedores(pv.proveedores); setProductos(p.productos.filter((x) => x.activo)); setPres(pr.presentaciones); setCompras(c.compras)
    if (t.tasa) setCab((c0) => (c0.tasa ? c0 : { ...c0, tasa: String(t.tasa!.valor) }))
  }, [])
  useEffect(() => { cargar().catch((e) => setMsg({ ok: false, texto: e.message })) }, [cargar])

  function elegirProveedor(id: string) {
    const p = proveedores.find((x) => x.id === id)
    setCab((c) => ({ ...c, proveedor_id: id, origen: p?.origen ?? c.origen, moneda: p?.origen === 'brasil' ? 'BRL' : 'COP' }))
  }
  async function proveedorRapido() {
    const nombre = await dialog.pedir({ title: 'Nuevo proveedor', label: 'Nombre', confirmText: 'Crear' })
    if (!nombre) return
    try {
      const r = await apiFetch<{ proveedor: Proveedor }>('/api/proveedores', { method: 'POST', body: JSON.stringify({ nombre, origen: cab.origen }) })
      setProveedores((ps) => [...ps, r.proveedor].sort((a, b) => a.nombre.localeCompare(b.nombre)))
      setCab((c) => ({ ...c, proveedor_id: r.proveedor.id }))
    } catch (e: any) { setMsg({ ok: false, texto: e.message }) }
  }
  function agregarProducto(p: Producto) {
    setLineas((ls) => [...ls, { key: nuevoId(), producto: p, presentacion_id: '', cantidad: '1', valor_unitario: '', fecha_vencimiento: '', margen_pct: String(p.margen_pct ?? 30), precio_venta: String(p.precio_venta) }])
    setBuscar('')
  }
  const setLinea = (key: string, cambios: Partial<Linea>) => setLineas((ls) => ls.map((l) => (l.key === key ? { ...l, ...cambios } : l)))

  // Mismo cálculo que el servidor: costos variables repartidos según el valor de cada línea.
  const enBrl = cab.moneda === 'BRL'
  const tasa = Number(cab.tasa) || 0
  const cv = Number(cab.costos_variables) || 0
  const base = lineas.map((l) => {
    const pr = pres.find((x) => x.id === l.presentacion_id)
    const factor = pr ? Number(pr.factor_unidades) : 1
    const valorLinea = (Number(l.cantidad) || 0) * (Number(l.valor_unitario) || 0)
    return { key: l.key, factor, unidades: (Number(l.cantidad) || 0) * factor, valorLinea, valorCop: enBrl ? valorLinea * tasa : valorLinea }
  })
  const subtotal = base.reduce((s, c) => s + c.valorLinea, 0)
  const subtotalCop = base.reduce((s, c) => s + c.valorCop, 0)
  const totalCop = Math.round(subtotalCop + cv)
  function calculo(l: Linea) {
    const c = base.find((x) => x.key === l.key)!
    const parte = subtotalCop > 0 ? (cv * c.valorCop) / subtotalCop : 0
    const costoUnd = c.unidades > 0 ? (c.valorCop + parte) / c.unidades : 0
    return { ...c, costoUnd, sugerido: Math.round(costoUnd * (1 + (Number(l.margen_pct) || 0) / 100)) }
  }

  async function registrar() {
    setMsg(null)
    if (!cab.proveedor_id) return setMsg({ ok: false, texto: 'Elige el proveedor' })
    if (!lineas.length) return setMsg({ ok: false, texto: 'Agrega al menos un producto' })
    if (enBrl && !(tasa > 0)) return setMsg({ ok: false, texto: 'Escribe la tasa del Real' })
    const forma = FORMAS.find((f) => f.id === cab.forma_pago)?.label
    const ok = await dialog.confirmar({ title: 'Registrar compra', message: `Total ${money(totalCop)} · ${forma}. Se sumarán las unidades al inventario y se actualizarán costos y precios.`, confirmText: 'Registrar' })
    if (!ok) return
    setGuardando(true)
    try {
      await apiFetch('/api/compras', {
        method: 'POST',
        body: JSON.stringify({
          ...cab, tasa: enBrl ? tasa : null, costos_variables: cv,
          items: lineas.map((l) => ({
            producto_id: l.producto.id, presentacion_id: l.presentacion_id || null, cantidad: Number(l.cantidad),
            valor_unitario: Number(l.valor_unitario), fecha_vencimiento: l.fecha_vencimiento || null,
            margen_pct: Number(l.margen_pct), precio_venta: Number(l.precio_venta),
          })),
        }),
      })
      setMsg({ ok: true, texto: 'Compra registrada: inventario, costos y precios actualizados.' })
      setLineas([]); setCab((c) => ({ ...cabeceraVacia(), tasa: c.tasa }))
      cargar()
    } catch (e: any) { setMsg({ ok: false, texto: e.message }) } finally { setGuardando(false) }
  }

  async function verDetalle(id: string) {
    try { setDetalle(await apiFetch(`/api/compras/${id}`)) } catch (e: any) { setMsg({ ok: false, texto: e.message }) }
  }
  async function pagar(c: CompraFila, forma: 'efectivo_caja' | 'transferencia') {
    const ok = await dialog.confirmar({ title: 'Registrar pago', message: `¿Pagar ${money(c.total)} a ${c.proveedor_nombre ?? 'el proveedor'} ${forma === 'efectivo_caja' ? 'con efectivo de la caja' : 'por transferencia'}?`, confirmText: 'Pagar' })
    if (!ok) return
    try { await apiFetch(`/api/compras/${c.id}/pagar`, { method: 'POST', body: JSON.stringify({ forma }) }); setMsg({ ok: true, texto: 'Pago registrado' }); cargar() }
    catch (e: any) { setMsg({ ok: false, texto: e.message }) }
  }
  async function crearProveedor(e: React.FormEvent) {
    e.preventDefault()
    try { await apiFetch('/api/proveedores', { method: 'POST', body: JSON.stringify(provForm) }); setProvForm({ nombre: '', contacto: '', nit: '', origen: 'colombia' }); cargar() }
    catch (e: any) { setMsg({ ok: false, texto: e.message }) }
  }
  async function alternarProveedor(p: Proveedor) {
    try { await apiFetch(`/api/proveedores/${p.id}`, { method: 'PATCH', body: JSON.stringify({ activo: !p.activo }) }); cargar() }
    catch (e: any) { setMsg({ ok: false, texto: e.message }) }
  }

  const q = buscar.trim().toLowerCase()
  const sugerencias = q ? productos.filter((p) => p.nombre.toLowerCase().includes(q)).slice(0, 8) : []
  const pendientes = compras.filter((c) => c.estado_pago === 'pendiente')
  const fmtMon = enBrl ? reales : money

  return (
    <>
      <div className="segmento" style={{ gridTemplateColumns: 'repeat(4, 1fr)', maxWidth: 640, marginBottom: 16 }}>
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'activo' : ''} onClick={() => { setTab(t.id); setMsg(null) }}>
            {t.label}{t.id === 'pagar' && pendientes.length > 0 ? ` (${pendientes.length})` : ''}
          </button>
        ))}
      </div>
      {msg && <div className={msg.ok ? 'aviso-ok' : 'alert'} style={{ marginBottom: 12 }}>{msg.texto}</div>}

      {tab === 'nueva' && (
        <div className="card" style={{ maxWidth: 'none' }}>
          <div className="grid2">
            <div className="field"><label>Proveedor</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <select value={cab.proveedor_id} onChange={(e) => elegirProveedor(e.target.value)}>
                  <option value="">Elige…</option>
                  {proveedores.filter((p) => p.activo).map((p) => <option key={p.id} value={p.id}>{p.origen === 'brasil' ? '🇧🇷 ' : '🇨🇴 '}{p.nombre}</option>)}
                </select>
                <button type="button" className="btn ghost" style={{ marginTop: 0, padding: '0 14px' }} onClick={proveedorRapido}>＋</button>
              </div>
            </div>
            <div className="grid2">
              <div className="field"><label>N.º factura</label><input value={cab.factura} onChange={(e) => setCab({ ...cab, factura: e.target.value })} /></div>
              <div className="field"><label>Fecha</label><input type="date" value={cab.fecha} onChange={(e) => setCab({ ...cab, fecha: e.target.value })} /></div>
            </div>
          </div>
          <div className="grid2" style={{ marginTop: 12 }}>
            <div className="field"><label>Origen y moneda</label>
              <div className="segmento">
                <button type="button" className={!enBrl ? 'activo' : ''} onClick={() => setCab({ ...cab, moneda: 'COP' })}>🇨🇴 Pesos</button>
                <button type="button" className={enBrl ? 'activo' : ''} onClick={() => setCab({ ...cab, moneda: 'BRL', origen: 'brasil' })}>🇧🇷 Reales</button>
              </div>
            </div>
            {enBrl && <div className="field"><label>Tasa (pesos por R$)</label><input type="number" inputMode="numeric" value={cab.tasa} onChange={(e) => setCab({ ...cab, tasa: e.target.value })} /></div>}
          </div>

          <div className="field" style={{ marginTop: 16 }}>
            <label>Agregar producto</label>
            <input className="buscar" value={buscar} placeholder="Escribe el nombre del producto…" onChange={(e) => setBuscar(e.target.value)} />
            {sugerencias.length > 0 && (
              <div className="sugerencias">
                {sugerencias.map((p) => <button key={p.id} type="button" onClick={() => agregarProducto(p)}>{p.nombre} <span className="faint">· {p.existencias} und · {money(p.precio_venta)}</span></button>)}
              </div>
            )}
          </div>

          {lineas.length > 0 && (
            <div className="tabla-wrap" style={{ marginTop: 12 }}>
              <table className="tabla" style={{ minWidth: 980 }}>
                <thead><tr>
                  <th>Producto</th><th>Llega como</th><th className="num">Cant.</th><th className="num">Valor c/u ({enBrl ? 'R$' : '$'})</th>
                  <th>Vence</th><th className="num">Costo und</th><th className="num">Margen %</th><th className="num">Precio venta</th><th></th>
                </tr></thead>
                <tbody>
                  {lineas.map((l) => {
                    const c = calculo(l)
                    const ps = pres.filter((x) => x.producto_id === l.producto.id)
                    return (
                      <tr key={l.key} style={{ cursor: 'default' }}>
                        <td>{l.producto.nombre}{c.unidades > 0 && <span className="desglose">= {c.unidades} und</span>}</td>
                        <td><select className="celda" value={l.presentacion_id} onChange={(e) => setLinea(l.key, { presentacion_id: e.target.value })}>
                          <option value="">Unidad</option>
                          {ps.map((p) => <option key={p.id} value={p.id}>{p.nombre} ({p.factor_unidades})</option>)}
                        </select></td>
                        <td className="num"><input className="celda" style={{ width: 64 }} type="number" inputMode="numeric" value={l.cantidad} onChange={(e) => setLinea(l.key, { cantidad: e.target.value })} /></td>
                        <td className="num"><input className="celda" style={{ width: 100 }} type="number" inputMode="decimal" step="0.01" value={l.valor_unitario} onChange={(e) => setLinea(l.key, { valor_unitario: e.target.value })} /></td>
                        <td>{l.producto.controla_vencimiento
                          ? <input className="celda" type="date" value={l.fecha_vencimiento} onChange={(e) => setLinea(l.key, { fecha_vencimiento: e.target.value })} />
                          : <span className="faint">—</span>}</td>
                        <td className="num">{money(c.costoUnd)}</td>
                        <td className="num"><input className="celda" style={{ width: 58 }} type="number" inputMode="numeric" value={l.margen_pct} onChange={(e) => setLinea(l.key, { margen_pct: e.target.value })} /></td>
                        <td className="num">
                          <input className="celda" style={{ width: 90 }} type="number" inputMode="numeric" value={l.precio_venta} onChange={(e) => setLinea(l.key, { precio_venta: e.target.value })} />
                          {c.sugerido > 0 && Number(l.precio_venta) !== c.sugerido && (
                            <button type="button" className="link-btn" style={{ display: 'block', fontSize: 11 }} onClick={() => setLinea(l.key, { precio_venta: String(c.sugerido) })}>usar sugerido {money(c.sugerido)}</button>
                          )}
                        </td>
                        <td><button type="button" className="link-btn" title="Quitar" onClick={() => setLineas((ls) => ls.filter((x) => x.key !== l.key))}>✕</button></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="grid2" style={{ marginTop: 16 }}>
            <div className="form" style={{ marginTop: 0 }}>
              <div className="field"><label>Costos variables (flete, cargue…) en pesos — un solo valor</label>
                <input type="number" inputMode="numeric" value={cab.costos_variables} onChange={(e) => setCab({ ...cab, costos_variables: e.target.value })} placeholder="0" /></div>
              <div className="field"><label>Forma de pago</label>
                <div className="segmento" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
                  {FORMAS.map((f) => <button key={f.id} type="button" className={cab.forma_pago === f.id ? 'activo' : ''} onClick={() => setCab({ ...cab, forma_pago: f.id })}>{f.label}</button>)}
                </div>
              </div>
              <div className="field"><label>Notas (opcional)</label><input value={cab.notas} onChange={(e) => setCab({ ...cab, notas: e.target.value })} /></div>
            </div>
            <div className="carrito" style={{ position: 'static' }}>
              <div className="row-between muted"><span>Subtotal</span><span>{fmtMon(subtotal)}{enBrl && <span className="faint"> = {money(subtotalCop)}</span>}</span></div>
              <div className="row-between muted" style={{ marginTop: 6 }}><span>Costos variables</span><span>{money(cv)}</span></div>
              <div className="total-grande">{money(totalCop)}</div>
              <p className="faint">Los costos variables se reparten entre los productos según su valor. El precio de venta solo cambia si lo modificas.</p>
              <button className="btn grande" disabled={guardando || !lineas.length} onClick={registrar}>{guardando ? 'Registrando…' : 'Registrar compra'}</button>
            </div>
          </div>
        </div>
      )}

      {tab === 'historial' && (
        <div className="tabla-wrap">
          <table className="tabla">
            <thead><tr><th>Fecha</th><th>Proveedor</th><th>Factura</th><th className="num">Total</th><th>Pago</th><th>Estado</th></tr></thead>
            <tbody>
              {compras.map((c) => (
                <tr key={c.id} onClick={() => verDetalle(c.id)}>
                  <td>{c.fecha}</td>
                  <td>{c.origen === 'brasil' ? '🇧🇷 ' : ''}{c.proveedor_nombre}</td>
                  <td>{c.factura ?? <span className="faint">—</span>}</td>
                  <td className="num">{money(c.total)}</td>
                  <td>{FORMA_LABEL[c.forma_pago] ?? c.forma_pago}</td>
                  <td>{c.estado_pago === 'pendiente' ? <span className="chip warn">Por pagar</span> : <span className="faint">Pagada</span>}</td>
                </tr>
              ))}
              {compras.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--faint)', padding: 24 }}>Aún no hay compras registradas.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'pagar' && (
        <div className="card" style={{ maxWidth: 720 }}>
          <h4 className="sub-modal">Compras a crédito por pagar {pendientes.length > 0 && <span className="faint">· total {money(pendientes.reduce((s, c) => s + Number(c.total), 0))}</span>}</h4>
          {pendientes.map((c) => (
            <div key={c.id} className="row-between" style={{ padding: '10px 0', borderBottom: '1px solid var(--line)', gap: 10, flexWrap: 'wrap' }}>
              <span>{c.proveedor_nombre} <span className="faint">· {c.fecha}{c.factura ? ` · F. ${c.factura}` : ''}</span><b style={{ display: 'block' }}>{money(c.total)}</b></span>
              <span style={{ display: 'flex', gap: 8 }}>
                <button className="btn ghost" style={{ marginTop: 0 }} onClick={() => pagar(c, 'transferencia')}>Pagar por transferencia</button>
                <button className="btn ghost" style={{ marginTop: 0 }} onClick={() => pagar(c, 'efectivo_caja')}>Pagar de la caja</button>
              </span>
            </div>
          ))}
          {pendientes.length === 0 && <p className="faint">No hay compras por pagar. 👌</p>}
        </div>
      )}

      {tab === 'proveedores' && (
        <div className="grid2" style={{ alignItems: 'start' }}>
          <form className="card" onSubmit={crearProveedor} style={{ maxWidth: 'none' }}>
            <h4 className="sub-modal">Nuevo proveedor</h4>
            <div className="form" style={{ marginTop: 0 }}>
              <div className="field"><label>Nombre</label><input value={provForm.nombre} onChange={(e) => setProvForm({ ...provForm, nombre: e.target.value })} required /></div>
              <div className="grid2">
                <div className="field"><label>Contacto</label><input value={provForm.contacto} placeholder="teléfono" onChange={(e) => setProvForm({ ...provForm, contacto: e.target.value })} /></div>
                <div className="field"><label>NIT (opcional)</label><input value={provForm.nit} onChange={(e) => setProvForm({ ...provForm, nit: e.target.value })} /></div>
              </div>
              <div className="field"><label>Origen</label>
                <select value={provForm.origen} onChange={(e) => setProvForm({ ...provForm, origen: e.target.value })}>
                  <option value="colombia">🇨🇴 Colombia</option><option value="brasil">🇧🇷 Brasil</option>
                </select></div>
              <button className="btn" type="submit">Crear proveedor</button>
            </div>
          </form>
          <div className="card" style={{ maxWidth: 'none' }}>
            <h4 className="sub-modal">Proveedores</h4>
            {proveedores.map((p) => (
              <div key={p.id} className="row-between" style={{ fontSize: 13.5, padding: '6px 0', opacity: p.activo ? 1 : 0.5 }}>
                <span>{p.origen === 'brasil' ? '🇧🇷' : '🇨🇴'} {p.nombre} <span className="faint">{p.contacto ? `· ${p.contacto}` : ''}{p.nit ? ` · NIT ${p.nit}` : ''}</span></span>
                <button className="link-btn" onClick={() => alternarProveedor(p)}>{p.activo ? 'Desactivar' : 'Activar'}</button>
              </div>
            ))}
            {proveedores.length === 0 && <p className="faint">Aún no hay proveedores.</p>}
          </div>
        </div>
      )}

      <Modal open={!!detalle} title="Detalle de compra" onClose={() => setDetalle(null)} ancho={640}>
        {detalle && (
          <div>
            <p className="muted">{detalle.compra.proveedor_nombre} · {detalle.compra.fecha}{detalle.compra.factura ? ` · Factura ${detalle.compra.factura}` : ''} · {FORMA_LABEL[detalle.compra.forma_pago]}{detalle.compra.estado_pago === 'pendiente' ? ' (por pagar)' : ''}</p>
            <div className="tabla-wrap" style={{ marginTop: 10 }}>
              <table className="tabla" style={{ minWidth: 520 }}>
                <thead><tr><th>Producto</th><th className="num">Cant.</th><th className="num">Und</th><th className="num">Costo und</th><th>Vence</th></tr></thead>
                <tbody>
                  {detalle.items.map((i: any) => (
                    <tr key={i.id} style={{ cursor: 'default' }}>
                      <td>{i.producto_nombre}{i.presentacion && <span className="faint"> · {i.presentacion}</span>}</td>
                      <td className="num">{i.cantidad}</td><td className="num">{i.unidades}</td>
                      <td className="num">{money(i.costo_unitario_cop)}</td><td>{i.fecha_vencimiento ?? <span className="faint">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="row-between" style={{ marginTop: 12 }}>
              <span className="muted">Costos variables {money(detalle.compra.costos_variables)}{detalle.compra.moneda === 'BRL' ? ` · tasa ${money(detalle.compra.tasa)}` : ''}</span>
              <b>{money(detalle.compra.total)}</b>
            </div>
            {detalle.compra.notas && <p className="faint" style={{ marginTop: 8 }}>{detalle.compra.notas}</p>}
          </div>
        )}
      </Modal>
    </>
  )
}
