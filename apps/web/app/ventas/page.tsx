'use client'

import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { apiFetch } from '../../lib/api'
import { AppShell, useSesion } from '../../components/AppShell'
import { useDialog } from '../../components/Dialog'
import { CambioEfectivo, PAGO_INICIAL, type PagoEfectivo } from '../../components/CambioEfectivo'
import { encolarVenta, nuevoId } from '../../lib/cola'
import { Posicion } from '../../components/Posicion'
import { Pais } from '../../components/Pais'
import { BotonCamara } from '../../components/EscanerCamara'
import { Modal } from '../../components/Modal'
import { resumirEmpaques, sueltosFaltantes, cerradasDisponibles, podarAperturas, type Apertura } from '../../lib/empaques'

interface Producto { id: string; nombre: string; precio_venta: number; existencias: number; foto_url: string | null; activo: boolean; categoria_nombre: string | null; codigo_barras: string | null; controla_empaques?: boolean; sueltos?: number }
interface Pres { id: string; producto_id: string; nombre: string; factor_unidades: number; precio: number; cerradas?: number; codigo_barras?: string | null }
interface Linea { key: string; producto: Producto; pres: Pres | null; cantidad: number }
interface Resumen { cantidad: number; total: number; por_medio: Record<string, number>; utilidad?: number }
interface Top { producto_id: string; nombre: string; veces: number; posicion: number; arrastre: boolean }
type Medio = 'efectivo' | 'nequi' | 'bold' | 'pix'

const money = (n: number) => '$' + Math.round(Number(n) || 0).toLocaleString('es-CO')
const reales = (n: number) => 'R$ ' + (Number(n) || 0).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const MEDIOS: { id: Medio; label: string }[] = [
  { id: 'efectivo', label: '💵 Efectivo' }, { id: 'nequi', label: '📱 Nequi' },
  { id: 'bold', label: '💳 Bold' }, { id: 'pix', label: '💠 PIX (R$)' },
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
  const [top, setTop] = useState<Top[]>([])
  const [tasa, setTasa] = useState<{ valor: number; es_de_hoy: boolean } | null>(null)
  const [cajaAbierta, setCajaAbierta] = useState<boolean | null>(null)
  const [resumen, setResumen] = useState<Resumen | null>(null)
  const [buscar, setBuscar] = useState('')
  const [carrito, setCarrito] = useState<Linea[]>([])
  const [carritoAbierto, setCarritoAbierto] = useState(false) // en celular el carrito va plegado abajo
  const [medio, setMedio] = useState<Medio>('efectivo')
  const [pago, setPago] = useState<PagoEfectivo>(PAGO_INICIAL)
  const [cobrando, setCobrando] = useState(false)
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null)
  // Cigarrillos (control por empaques): empaques que se abren en esta venta y productos que el
  // cajero decidió vender sin abrir. Las aperturas viajan con la venta al servidor.
  const [aperturas, setAperturas] = useState<Apertura[]>([])
  const [sinAbrir, setSinAbrir] = useState<string[]>([])

  const cargar = useCallback(async () => {
    const [p, pr, t, v, c, tp] = await Promise.all([
      apiFetch<{ productos: Producto[] }>('/api/productos'),
      apiFetch<{ presentaciones: Pres[] }>('/api/presentaciones'),
      apiFetch<{ tasa: { valor: number } | null; es_de_hoy: boolean }>('/api/tasa'),
      apiFetch<{ resumen: Resumen }>('/api/ventas/hoy'),
      apiFetch<{ abierta: boolean }>('/api/caja/actual'),
      apiFetch<{ top: Top[] }>('/api/top-ventas').catch(() => ({ top: [] as Top[] })),
    ])
    setProductos(p.productos.filter((x) => x.activo))
    setPres(pr.presentaciones)
    setTasa(t.tasa ? { valor: Number(t.tasa.valor), es_de_hoy: t.es_de_hoy } : null)
    setResumen(v.resumen)
    setCajaAbierta(c.abierta)
    setTop(tp.top)
  }, [])
  useEffect(() => { cargar().catch((e) => setMsg({ tipo: 'error', texto: e.message })) }, [cargar])

  const filtrados = useMemo(() => {
    const q = buscar.trim().toLowerCase()
    if (!q) return productos
    return productos.filter((p) => p.nombre.toLowerCase().includes(q) || (p.categoria_nombre ?? '').toLowerCase().includes(q) || (p.codigo_barras ?? '').includes(q))
  }, [productos, buscar])

  // Más vendidos del mes que siguen activos, en el orden del podio. Si alguno
  // quedó inactivo se renumera, para que no queden huecos en los puestos.
  const topProductos = useMemo(
    () => top
      .map((t) => ({ t, p: productos.find((x) => x.id === t.producto_id) }))
      .filter((x): x is { t: Top; p: Producto } => !!x.p)
      .map((x, i) => ({ ...x, puesto: i + 1 })),
    [top, productos],
  )

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
  function fijarCantidad(key: string, cantidad: number) {
    setCarrito((c) => c.map((l) => (l.key === key ? { ...l, cantidad } : l)))
  }

  // ── Control por empaques en la venta ──
  const presDe = (productoId: string) => pres.filter((x) => x.producto_id === productoId)
  // Por cada cigarrillo en la venta: sueltos pedidos y empaques cerrados pedidos por presentación.
  const empaquesEnVenta = useMemo(() => {
    const m = new Map<string, { p: Producto; sueltos: number; cerradas: Record<string, number> }>()
    for (const l of carrito) {
      if (!l.producto.controla_empaques) continue
      const e = m.get(l.producto.id) ?? { p: l.producto, sueltos: 0, cerradas: {} }
      if (l.pres) e.cerradas[l.pres.id] = (e.cerradas[l.pres.id] ?? 0) + l.cantidad
      else e.sueltos += l.cantidad
      m.set(l.producto.id, e)
    }
    return m
  }, [carrito])
  // Si la venta ya no necesita un empaque abierto (se quitó un suelto), se desmarca.
  useEffect(() => {
    setAperturas((actuales) => {
      const nuevas = [...empaquesEnVenta.values()].flatMap(({ p, sueltos }) =>
        podarAperturas(p.sueltos, sueltos, actuales.filter((a) => a.producto_id === p.id), pres.filter((x) => x.producto_id === p.id)))
      return nuevas.length === actuales.length ? actuales : nuevas
    })
    if (carrito.length === 0) setSinAbrir([])
  }, [empaquesEnVenta, pres, carrito.length])
  // Cigarrillo al que le faltan sueltos para la venta y que tiene empaques cerrados para abrir.
  const faltaAbrir = useMemo(() => {
    for (const { p, sueltos, cerradas } of empaquesEnVenta.values()) {
      if (sinAbrir.includes(p.id)) continue
      const ps = pres.filter((x) => x.producto_id === p.id)
      const suyas = aperturas.filter((a) => a.producto_id === p.id)
      const falta = sueltosFaltantes(p.sueltos, sueltos, suyas, ps)
      if (falta <= 0) continue
      const opciones = ps.filter((x) => Number(x.factor_unidades) > 1)
        .map((x) => ({ x, quedan: cerradasDisponibles(x, cerradas[x.id] ?? 0, suyas) }))
        .filter((o) => o.quedan > 0)
      if (opciones.length) return { p, falta, opciones }
    }
    return null
  }, [empaquesEnVenta, aperturas, sinAbrir, pres])

  const total = carrito.reduce((s, l) => s + precioDe(l) * l.cantidad, 0)
  const unidades = carrito.reduce((s, l) => s + l.cantidad, 0)
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
      aperturas: aperturas.length ? aperturas : undefined,
    }
    const limpiar = () => { setCarrito([]); setAperturas([]); setSinAbrir([]); setMedio('efectivo'); setPago(PAGO_INICIAL); setBuscar(''); setCarritoAbierto(false); buscarRef.current?.focus() }
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
          if (!u) return p
          if (!p.controla_empaques) return { ...p, existencias: p.existencias - u }
          // Sin señal también se mueven los sueltos: entran los del empaque abierto y salen los vendidos.
          const abiertos = aperturas.filter((a) => a.producto_id === p.id).reduce((s, a) => s + (Number(pres.find((x) => x.id === a.presentacion_id)?.factor_unidades) || 0), 0)
          const sueltosVendidos = carrito.filter((l) => l.producto.id === p.id && !l.pres).reduce((s, l) => s + l.cantidad, 0)
          return { ...p, existencias: p.existencias - u, sueltos: (p.sueltos ?? 0) + abiertos - sueltosVendidos }
        }))
        setPres((xs) => xs.map((x) => {
          if (!productos.find((p) => p.id === x.producto_id)?.controla_empaques) return x
          const menos = carrito.filter((l) => l.pres?.id === x.id).reduce((s, l) => s + l.cantidad, 0) + aperturas.filter((a) => a.presentacion_id === x.id).length
          return menos ? { ...x, cerradas: (x.cerradas ?? 0) - menos } : x
        }))
        setMsg({ tipo: 'ok', texto: `Sin conexión: venta de ${money(total)} guardada en el equipo; se enviará sola al volver la señal.` })
        limpiar()
      } else setMsg({ tipo: 'error', texto: e.message })
    } finally { setCobrando(false) }
  }

  // Enter: primero busca el código de barras exacto (lector); si no, agrega el primer resultado.
  function onBuscarKey(e: React.KeyboardEvent) {
    if (e.key !== 'Enter') return
    const q = buscar.trim()
    const leido = q ? buscarCodigo(q) : null
    if (leido) { agregar(leido.p, leido.x); setBuscar(''); return }
    const elegido = filtrados[0]
    if (elegido) { agregar(elegido, null); setBuscar('') }
    else if (q) setMsg({ tipo: 'error', texto: `No encontré "${q}"` })
  }

  // Un código puede ser de un producto (se vende la unidad) o de una presentación (cajetilla, media…).
  function buscarCodigo(codigo: string): { p: Producto; x: Pres | null } | null {
    const x = pres.find((y) => y.codigo_barras && y.codigo_barras === codigo)
    const dePres = x ? productos.find((q) => q.id === x.producto_id) : undefined
    if (x && dePres) return { p: dePres, x }
    const p = productos.find((q) => q.codigo_barras && q.codigo_barras === codigo)
    return p ? { p, x: null } : null
  }

  // Lector de código de barras en toda la pantalla: el lector "escribe" muy rápido y termina
  // en Enter. Así cada lectura entra directo al carrito aunque el foco haya quedado en un
  // botón, y ese Enter nunca presiona el botón enfocado (por ejemplo, Cobrar).
  const lector = useRef({ texto: '', ultima: 0 })
  const alLeerCodigo = useRef<(codigo: string) => void>(() => {})
  alLeerCodigo.current = (codigo) => {
    const leido = buscarCodigo(codigo)
    if (leido) agregar(leido.p, leido.x)
    else setMsg({ tipo: 'error', texto: `No encontré el código ${codigo}` })
    buscarRef.current?.focus()
  }
  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      // En los campos (buscador, cantidad, recibido…) manda lo que se escribe ahí.
      if (t && (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.isContentEditable)) return
      const l = lector.current
      const ahora = performance.now()
      if (ahora - l.ultima > 60) l.texto = '' // pausa larga: es una persona tecleando
      l.ultima = ahora
      if (e.key === 'Enter') {
        if (l.texto.length >= 4) { e.preventDefault(); e.stopPropagation(); alLeerCodigo.current(l.texto) }
        l.texto = ''
      } else if (e.key.length === 1) l.texto += e.key
    }
    window.addEventListener('keydown', alTeclear, true)
    return () => window.removeEventListener('keydown', alTeclear, true)
  }, [])

  return (
    <div className="pos">
      <div>
        <div className="toolbar" style={{ marginTop: 0 }}>
          <input ref={buscarRef} autoFocus className="buscar" placeholder="Buscar o escanear código… (Enter agrega)"
            value={buscar} onChange={(e) => setBuscar(e.target.value)} onKeyDown={onBuscarKey} />
          <BotonCamara continuo titulo="Escanear productos" onCodigo={(codigo) => {
            const leido = buscarCodigo(codigo)
            if (!leido) return 'No encontré el código ' + codigo
            agregar(leido.p, leido.x)
            return '＋ ' + leido.p.nombre + (leido.x ? ' · ' + leido.x.nombre : '')
          }} />
        </div>

        {!buscar && topProductos.length > 0 && (
          <div className="top-ventas">
            <span className="faint" style={{ marginRight: 4 }}>🔥 Más vendidos del mes</span>
            {topProductos.map(({ t, p, puesto }) => (
              <button key={p.id} type="button" className={'pos-chip top' + (t.arrastre ? ' arrastre' : '')}
                title={t.arrastre ? 'Venía en el podio del mes pasado; aún no se vende este mes' : `${t.veces} venta(s) este mes`}
                onClick={() => agregar(p, null)}>
                <Posicion n={puesto} />{p.nombre}<b>{money(p.precio_venta)}</b>
              </button>
            ))}
          </div>
        )}

        <div className="pos-grid">
          {filtrados.map((p) => {
            const ps = pres.filter((x) => x.producto_id === p.id && Number(x.factor_unidades) > 1).sort((a, b) => a.factor_unidades - b.factor_unidades)
            return (
              <div key={p.id} className="pos-card" onClick={() => agregar(p, null)}>
                {p.foto_url ? <img src={p.foto_url} alt="" /> : <span className="sinfoto">🍾</span>}
                <span className="nom">{p.nombre}</span>
                <span className="pre">{money(p.precio_venta)} <span className="faint" style={{ fontWeight: 400 }}>· {p.existencias} und</span></span>
                {p.controla_empaques && <span className="desglose" style={{ whiteSpace: 'normal' }}>{resumirEmpaques(p.sueltos, presDe(p.id))}</span>}
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
          {filtrados.length === 0 && (
            cajaAbierta === null
              ? <p className="faint">Cargando productos…</p>
              : <p className="faint">{productos.length ? 'Sin resultados.' : 'No hay productos activos en el inventario.'}</p>
          )}
        </div>
      </div>

      <Modal open={!!faltaAbrir} title="Abrir un empaque" onClose={() => { if (faltaAbrir) setSinAbrir((s) => [...s, faltaAbrir.p.id]) }}>
        {faltaAbrir && (
          <div>
            <p className="muted" style={{ lineHeight: 1.5 }}>
              No quedan sueltos de <b>{faltaAbrir.p.nombre}</b> para esta venta (faltan {faltaAbrir.falta}). ¿Qué abres?
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
              {faltaAbrir.opciones.map(({ x, quedan }) => (
                <button key={x.id} type="button" className="btn" style={{ marginTop: 0 }}
                  onClick={() => setAperturas((as) => [...as, { producto_id: faltaAbrir.p.id, presentacion_id: x.id }])}>
                  Abrir {x.nombre.toLowerCase()} ({x.factor_unidades} und) · quedan {quedan} cerrada{quedan === 1 ? '' : 's'}
                </button>
              ))}
              <button type="button" className="btn ghost" style={{ marginTop: 0 }} onClick={() => setSinAbrir((s) => [...s, faltaAbrir.p.id])}>
                Vender sin abrir (revisar el conteo después)
              </button>
            </div>
          </div>
        )}
      </Modal>

      <aside className={'carrito' + (carritoAbierto ? '' : ' plegado')}>
        {/* En celular: barra fija abajo; al tocarla se despliega el carrito completo */}
        <button type="button" className="barra-carrito" onClick={() => setCarritoAbierto((v) => !v)}>
          <span>{unidades ? `${unidades} ítem(s)` : 'Sin productos'}</span>
          <span className="tot">{money(total)}</span>
          <span className="ver">{carritoAbierto ? 'Ocultar ▾' : 'Ver ▴'}</span>
        </button>

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
                {!l.pres && l.producto.controla_empaques && aperturas.some((a) => a.producto_id === l.producto.id) && (
                  <span className="faint" style={{ display: 'block' }}>
                    📦 abre {aperturas.filter((a) => a.producto_id === l.producto.id).map((a) => pres.find((x) => x.id === a.presentacion_id)?.nombre.toLowerCase()).join(' + ')}
                  </span>
                )}
              </span>
              <span className="qty">
                <button onClick={() => cambiarCantidad(l.key, -1)}>−</button>
                <Cantidad valor={l.cantidad} onCambiar={(n) => fijarCantidad(l.key, n)} />
                <button onClick={() => cambiarCantidad(l.key, 1)}>+</button>
              </span>
              <b style={{ minWidth: 72, textAlign: 'right' }}>{money(precioDe(l) * l.cantidad)}</b>
            </div>
          ))}
          {carrito.length === 0 && <p className="faint" style={{ padding: '10px 0' }}>Toca un producto o escanéalo para agregarlo.</p>}
        </div>

        <div className="total-grande">{money(total)}</div>
        {medio === 'pix' && (tasaHoy
          ? <div className="muted">≈ <b>{reales(total / tasaHoy)}</b> <span className="faint">(1 R$ = {money(tasaHoy)})</span></div>
          : <div className="alert" style={{ marginTop: 6 }}>Falta la tasa del Real de hoy.{gestor ? '' : ' Pídele al administrador que la registre.'}</div>
        )}
        {gestor && (
          <button className="link-btn" style={{ marginTop: 8 }} onClick={registrarTasa}>
            <Pais origen="brasil" />Tasa del Real: {tasa ? money(tasa.valor) + (tasa.es_de_hoy ? ' (hoy)' : ' (desactualizada)') : 'sin registrar'} · cambiar
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

// Cantidad en el carrito: − / + para lo de siempre, y escribible para pedidos
// grandes (10, 24, 30…) sin tocar el botón muchas veces.
function Cantidad({ valor, onCambiar }: { valor: number; onCambiar: (n: number) => void }) {
  const [texto, setTexto] = useState(String(valor))
  useEffect(() => { setTexto(String(valor)) }, [valor])
  return (
    <input className="qty-input" type="text" inputMode="numeric" aria-label="Cantidad" value={texto}
      onFocus={(e) => e.target.select()}
      onChange={(e) => {
        const limpio = e.target.value.replace(/\D/g, '').slice(0, 4)
        setTexto(limpio)
        if (Number(limpio) > 0) onCambiar(Number(limpio))
      }}
      onBlur={() => setTexto(String(valor))}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }} />
  )
}
