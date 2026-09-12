'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { apiFetch } from '../../lib/api'
import { AppShell, useSesion } from '../../components/AppShell'
import { StockBajo } from '../../components/StockBajo'

interface PuntoSerie { fecha: string; ventas: number; total: number; utilidad: number; gastos: number; ganancia: number }
interface Reporte {
  desde: string; hasta: string; dias: number
  resumen: { ventas: number; total: number; costo: number; utilidad: number; gastos: number; ganancia_neta: number; margen_bruto: number | null; relacion_gastos: number | null; ticket_promedio: number; promedio_diario: number; valor_inventario: number }
  comparacion: { desde: string; hasta: string; total: number; ganancia_neta: number; crecimiento_ventas: number | null; crecimiento_ganancia: number | null }
  serie: PuntoSerie[]
  por_medio: { medio: string; ventas: number; total: number; reales: number }[]
  gastos_por_categoria: Record<string, number>
  mas_vendidos: { producto_id: string; nombre: string; es_pola: boolean; unidades: number; total: number; utilidad: number; existencias: number; dias_inventario: number | null }[]
  sin_movimiento: { nombre: string; existencias: number; valor: number }[]
  pola: { productos: { nombre: string; unidades: number; total: number }[]; unidades: number; total: number }
  por_vencer: { nombre: string; cantidad: number; fecha: string; dias: number }[]
  cierres: { fecha_jornada: string; total_ventas: number; diferencia: number; diferencia_reales: number }[]
}

const money = (n: number) => '$' + Math.round(Number(n) || 0).toLocaleString('es-CO')
const corto = (n: number) => (Math.abs(n) >= 1e6 ? `$${(n / 1e6).toLocaleString('es-CO', { maximumFractionDigits: 1 })} M` : Math.abs(n) >= 1e3 ? `$${Math.round(n / 1e3)} mil` : `$${Math.round(n)}`)
const hoyLocal = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' })
const diaCorto = (f: string) => new Date(f + 'T12:00:00').toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit' })
const diaLargo = (f: string) => new Date(f + 'T12:00:00').toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
const MEDIO: Record<string, string> = { efectivo: 'Efectivo', nequi: 'Nequi', bold: 'Bold', pix: 'PIX' }
const CATEGORIA: Record<string, string> = { arriendo: 'Arriendo', servicios: 'Servicios', nomina: 'Nómina', transporte: 'Transporte', mantenimiento: 'Mantenimiento', impuestos: 'Impuestos', otros: 'Otros' }

type Periodo = 'hoy' | 'semana' | 'mes' | 'mes_pasado'
function periodo(tipo: Periodo) {
  const h = hoyLocal()
  const d = new Date(h + 'T12:00:00')
  const iso = (x: Date) => x.toLocaleDateString('en-CA')
  if (tipo === 'hoy') return { desde: h, hasta: h }
  if (tipo === 'semana') { const l = new Date(d); l.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return { desde: iso(l), hasta: h } }
  if (tipo === 'mes') return { desde: h.slice(0, 8) + '01', hasta: h }
  return { desde: iso(new Date(d.getFullYear(), d.getMonth() - 1, 1, 12)), hasta: iso(new Date(d.getFullYear(), d.getMonth(), 0, 12)) }
}

// Variación contra el periodo anterior: flecha + texto (nunca solo color).
function Variacion({ pct }: { pct: number | null }) {
  if (pct === null) return <div className="cambio-pct faint">sin datos del periodo anterior</div>
  const sube = pct >= 0
  return <div className={'cambio-pct ' + (sube ? 'dif-ok' : 'dif-mal')}>{sube ? '▲' : '▼'} {Math.abs(pct).toLocaleString('es-CO')}% vs periodo anterior</div>
}

// Ventas por jornada: una sola serie en barras, con tooltip al pasar el mouse.
function GraficaVentas({ serie }: { serie: PuntoSerie[] }) {
  const [hover, setHover] = useState<number | null>(null)
  const W = 760, H = 230
  const pad = { t: 14, r: 10, b: 28, l: 58 }
  const iw = W - pad.l - pad.r
  const ih = H - pad.t - pad.b
  const max = Math.max(...serie.map((s) => s.total), 1)
  const exp = 10 ** Math.floor(Math.log10(max))
  const tope = (max / exp <= 1 ? 1 : max / exp <= 2 ? 2 : max / exp <= 5 ? 5 : 10) * exp
  const paso = iw / serie.length
  const ancho = Math.max(2, Math.min(34, paso - 2)) // 2 px de separación entre barras
  const cadaCuanto = Math.ceil(serie.length / 10) // etiquetas del eje x sin amontonarse
  const y = (v: number) => pad.t + ih - (v / tope) * ih

  // Barra con esquinas superiores redondeadas (4 px), anclada a la base.
  const barra = (x: number, v: number) => {
    const top = y(v); const h = pad.t + ih - top
    if (h <= 0) return ''
    const r = Math.min(4, ancho / 2, h)
    return `M${x},${top + h} L${x},${top + r} Q${x},${top} ${x + r},${top} L${x + ancho - r},${top} Q${x + ancho},${top} ${x + ancho},${top + r} L${x + ancho},${top + h} Z`
  }
  const p = hover !== null ? serie[hover] : null

  return (
    <div className="grafica" onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Ventas por jornada">
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={pad.l} x2={W - pad.r} y1={y(tope * f)} y2={y(tope * f)} stroke="var(--line)" strokeWidth={1} />
            <text x={pad.l - 8} y={y(tope * f) + 4} textAnchor="end" fontSize={11} fill="var(--faint)">{corto(tope * f)}</text>
          </g>
        ))}
        {serie.map((s, i) => {
          const x = pad.l + i * paso + (paso - ancho) / 2
          return (
            <g key={s.fecha}>
              <path d={barra(x, s.total)} fill={hover === i ? 'var(--amber-bright)' : 'var(--amber)'} />
              {i % cadaCuanto === 0 && <text x={pad.l + i * paso + paso / 2} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--faint)">{diaCorto(s.fecha)}</text>}
              {/* Zona de hover más grande que la barra */}
              <rect x={pad.l + i * paso} y={pad.t} width={paso} height={ih} fill="transparent" onMouseEnter={() => setHover(i)} />
            </g>
          )
        })}
      </svg>
      {p && hover !== null && (
        <div className="tooltip-graf" style={{ left: `${Math.min(88, Math.max(12, ((pad.l + hover * paso + paso / 2) / W) * 100))}%` }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{diaLargo(p.fecha)}</div>
          <div className="fila">Ventas <b>{money(p.total)}</b></div>
          <div className="fila"># ventas <b>{p.ventas}</b></div>
          <div className="fila">Utilidad bruta <b>{money(p.utilidad)}</b></div>
          <div className="fila">Gastos <b>{money(p.gastos)}</b></div>
          <div className="fila">Ganancia neta <b>{money(p.ganancia)}</b></div>
        </div>
      )}
    </div>
  )
}

export default function ReportesPage() {
  return <AppShell active="reportes" titulo="Reportes"><Reportes /></AppShell>
}

function Reportes() {
  const me = useSesion()
  const router = useRouter()
  useEffect(() => { if (me.usuario.rol === 'cajero') router.replace('/ventas') }, [me, router])

  const [rango, setRango] = useState(periodo('mes'))
  const [data, setData] = useState<Reporte | null>(null)
  const [cargando, setCargando] = useState(true)
  const [msg, setMsg] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    try { setData(await apiFetch<Reporte>(`/api/reportes?desde=${rango.desde}&hasta=${rango.hasta}`)); setMsg(null) }
    catch (e: any) { setMsg(e.message) } finally { setCargando(false) }
  }, [rango])
  useEffect(() => { cargar() }, [cargar])

  const r = data?.resumen
  const unDia = rango.desde === rango.hasta
  const titulo = unDia ? `Cierre diario · ${diaLargo(rango.desde)}` : `Del ${diaLargo(rango.desde)} al ${diaLargo(rango.hasta)}`

  return (
    <>
      <div className="toolbar no-imprimir" style={{ marginTop: 0 }}>
        {([['hoy', 'Hoy (cierre diario)'], ['semana', 'Esta semana'], ['mes', 'Este mes'], ['mes_pasado', 'Mes pasado']] as const).map(([k, l]) => (
          <button key={k} className="pos-chip" style={{ fontSize: 12, padding: '6px 11px' }} onClick={() => setRango(periodo(k))}>{l}</button>
        ))}
        <input type="date" className="celda" style={{ width: 150 }} value={rango.desde} onChange={(e) => setRango({ ...rango, desde: e.target.value })} />
        <span className="faint">a</span>
        <input type="date" className="celda" style={{ width: 150 }} value={rango.hasta} onChange={(e) => setRango({ ...rango, hasta: e.target.value })} />
        <button className="btn ghost" style={{ marginTop: 0, marginLeft: 'auto' }} onClick={() => window.print()}>🖨 Imprimir</button>
      </div>
      {msg && <div className="alert" style={{ marginBottom: 12 }}>{msg}</div>}
      <h2 style={{ fontFamily: 'Fraunces,serif', fontWeight: 500, fontSize: 20, marginBottom: 4 }}>{titulo.charAt(0).toUpperCase() + titulo.slice(1)}</h2>
      <p className="faint" style={{ marginBottom: 12 }}>Cada venta cuenta para la jornada de su caja (aunque se cierre después de medianoche).{cargando ? ' · Actualizando…' : ''}</p>

      {r && data && (
        <>
          <div className="tiles" style={{ marginTop: 0 }}>
            <div className="tile"><div className="t">Ventas</div><div className="v">{money(r.total)}</div>
              <div className="s">{r.ventas} venta(s) · ticket {money(r.ticket_promedio)}</div><Variacion pct={data.comparacion.crecimiento_ventas} /></div>
            <div className="tile"><div className="t">Utilidad bruta</div><div className="v">{money(r.utilidad)}</div>
              <div className="s">Margen {r.margen_bruto ?? 0}% · costo vendido {money(r.costo)}</div></div>
            <div className="tile"><div className="t">Gastos</div><div className="v">{money(r.gastos)}</div>
              <div className="s">{r.relacion_gastos !== null ? `${r.relacion_gastos}% de las ventas` : 'sin ventas en el periodo'}</div></div>
            <div className="tile"><div className="t">Ganancia neta</div><div className={'v ' + (r.ganancia_neta >= 0 ? 'dif-ok' : 'dif-mal')}>{money(r.ganancia_neta)}</div>
              <div className="s">Ventas − costo − gastos</div><Variacion pct={data.comparacion.crecimiento_ganancia} /></div>
            {!unDia && <div className="tile"><div className="t">Promedio por día</div><div className="v">{money(r.promedio_diario)}</div><div className="s">{data.dias} día(s)</div></div>}
            <div className="tile"><div className="t">Valor del inventario</div><div className="v">{money(r.valor_inventario)}</div><div className="s">a costo, hoy</div></div>
          </div>

          {data.serie.length > 1 && (
            <div className="seccion-rep">
              <h3>Ventas por jornada</h3>
              <GraficaVentas serie={data.serie} />
            </div>
          )}

          <div className="grid-2col seccion-rep">
            <div>
              <h3>Por medio de pago</h3>
              <div className="tabla-wrap"><table className="tabla" style={{ minWidth: 0 }}>
                <thead><tr><th>Medio</th><th className="num">Ventas</th><th className="num">Total</th></tr></thead>
                <tbody>
                  {data.por_medio.map((m) => (
                    <tr key={m.medio} style={{ cursor: 'default' }}><td>{MEDIO[m.medio] ?? m.medio}</td><td className="num">{m.ventas}</td>
                      <td className="num">{money(m.total)}{m.reales > 0 && <span className="desglose">R$ {m.reales.toLocaleString('es-CO', { maximumFractionDigits: 2 })}</span>}</td></tr>
                  ))}
                  {data.por_medio.length === 0 && <tr><td colSpan={3} className="faint" style={{ textAlign: 'center', padding: 16 }}>Sin ventas.</td></tr>}
                </tbody>
              </table></div>
            </div>
            <div>
              <h3>Gastos por categoría</h3>
              <div className="tabla-wrap"><table className="tabla" style={{ minWidth: 0 }}>
                <thead><tr><th>Categoría</th><th className="num">Total</th><th className="num">% de ventas</th></tr></thead>
                <tbody>
                  {Object.entries(data.gastos_por_categoria).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
                    <tr key={k} style={{ cursor: 'default' }}><td>{CATEGORIA[k] ?? k}</td><td className="num">{money(v)}</td><td className="num">{r.total ? `${Math.round((v / r.total) * 1000) / 10}%` : '—'}</td></tr>
                  ))}
                  {Object.keys(data.gastos_por_categoria).length === 0 && <tr><td colSpan={3} className="faint" style={{ textAlign: 'center', padding: 16 }}>Sin gastos.</td></tr>}
                </tbody>
              </table></div>
            </div>
          </div>

          <div className="seccion-rep">
            <h3>Más vendidos y rotación</h3>
            <div className="tabla-wrap"><table className="tabla">
              <thead><tr><th>Producto</th><th className="num">Unidades</th><th className="num">Ventas</th><th className="num">Utilidad</th><th className="num">Existencias</th><th className="num">Alcanza para</th></tr></thead>
              <tbody>
                {data.mas_vendidos.map((p) => (
                  <tr key={p.producto_id} style={{ cursor: 'default' }}>
                    <td>{p.nombre}{p.es_pola && <span className="sello-pola">POLA</span>}</td>
                    <td className="num">{p.unidades.toLocaleString('es-CO')}</td><td className="num">{money(p.total)}</td><td className="num">{money(p.utilidad)}</td>
                    <td className="num">{p.existencias}</td>
                    <td className="num">{p.existencias <= 0 ? <span className="dif-mal">Sin stock</span> : p.dias_inventario === null ? '—' : p.dias_inventario <= 3 ? <span className="dif-mal">⚠ {p.dias_inventario} día(s)</span> : `${p.dias_inventario} días`}</td>
                  </tr>
                ))}
                {data.mas_vendidos.length === 0 && <tr><td colSpan={6} className="faint" style={{ textAlign: 'center', padding: 16 }}>Sin ventas en el periodo.</td></tr>}
              </tbody>
            </table></div>
            <p className="faint" style={{ marginTop: 6 }}>"Alcanza para": días que dura el inventario actual al ritmo de venta del periodo.</p>
          </div>

          <StockBajo />

          <div className="grid-2col seccion-rep">
            <div>
              <h3>Productos POLA</h3>
              <p className="faint" style={{ marginBottom: 8 }}>Lo vendido de productos surtidos por el bar: {data.pola.unidades.toLocaleString('es-CO')} und · <b>{money(data.pola.total)}</b></p>
              <div className="tabla-wrap"><table className="tabla" style={{ minWidth: 0 }}>
                <thead><tr><th>Producto</th><th className="num">Unidades</th><th className="num">Total vendido</th></tr></thead>
                <tbody>
                  {data.pola.productos.map((p) => <tr key={p.nombre} style={{ cursor: 'default' }}><td>{p.nombre}</td><td className="num">{p.unidades}</td><td className="num">{money(p.total)}</td></tr>)}
                  {data.pola.productos.length === 0 && <tr><td colSpan={3} className="faint" style={{ textAlign: 'center', padding: 16 }}>Sin ventas POLA en el periodo.</td></tr>}
                </tbody>
              </table></div>
            </div>
            <div>
              <h3>Próximos a vencer (30 días)</h3>
              <div className="tabla-wrap"><table className="tabla" style={{ minWidth: 0 }}>
                <thead><tr><th>Producto</th><th className="num">Und</th><th>Vence</th></tr></thead>
                <tbody>
                  {data.por_vencer.map((l, i) => (
                    <tr key={i} style={{ cursor: 'default' }}><td>{l.nombre}</td><td className="num">{l.cantidad}</td>
                      <td>{l.dias < 0 ? <span className="dif-mal">⚠ Vencido ({diaCorto(l.fecha)})</span> : l.dias === 0 ? <span className="dif-mal">⚠ Hoy</span> : `${diaCorto(l.fecha)} · en ${l.dias} día(s)`}</td></tr>
                  ))}
                  {data.por_vencer.length === 0 && <tr><td colSpan={3} className="faint" style={{ textAlign: 'center', padding: 16 }}>Nada por vencer. 👌</td></tr>}
                </tbody>
              </table></div>
            </div>
          </div>

          <div className="grid-2col seccion-rep">
            <div>
              <h3>Sin movimiento</h3>
              <p className="faint" style={{ marginBottom: 8 }}>Con existencias pero sin ventas en el periodo (dinero quieto a costo).</p>
              <div className="tabla-wrap"><table className="tabla" style={{ minWidth: 0 }}>
                <thead><tr><th>Producto</th><th className="num">Existencias</th><th className="num">Valor</th></tr></thead>
                <tbody>
                  {data.sin_movimiento.map((p) => <tr key={p.nombre} style={{ cursor: 'default' }}><td>{p.nombre}</td><td className="num">{p.existencias}</td><td className="num">{money(p.valor)}</td></tr>)}
                  {data.sin_movimiento.length === 0 && <tr><td colSpan={3} className="faint" style={{ textAlign: 'center', padding: 16 }}>Todo se movió. 👌</td></tr>}
                </tbody>
              </table></div>
            </div>
            <div>
              <h3>Cierres de caja</h3>
              <div className="tabla-wrap"><table className="tabla" style={{ minWidth: 0 }}>
                <thead><tr><th>Jornada</th><th className="num">Ventas</th><th className="num">Diferencia</th></tr></thead>
                <tbody>
                  {data.cierres.map((c, i) => (
                    <tr key={i} style={{ cursor: 'default' }}><td>{diaCorto(c.fecha_jornada)}</td><td className="num">{money(c.total_ventas)}</td>
                      <td className="num">{Math.abs(Number(c.diferencia)) < 1 ? <span className="dif-ok">Cuadra ✓</span> : <span className={Number(c.diferencia) > 0 ? 'dif-ok' : 'dif-mal'}>{Number(c.diferencia) > 0 ? '+' : '−'}{money(Math.abs(Number(c.diferencia)))}</span>}</td></tr>
                  ))}
                  {data.cierres.length === 0 && <tr><td colSpan={3} className="faint" style={{ textAlign: 'center', padding: 16 }}>Sin cierres en el periodo.</td></tr>}
                </tbody>
              </table></div>
            </div>
          </div>

          {data.serie.length > 0 && (
            <div className="seccion-rep">
              <h3>Detalle por jornada</h3>
              <div className="tabla-wrap"><table className="tabla" style={{ minWidth: 640 }}>
                <thead><tr><th>Jornada</th><th className="num"># ventas</th><th className="num">Ventas</th><th className="num">Utilidad bruta</th><th className="num">Gastos</th><th className="num">Ganancia neta</th></tr></thead>
                <tbody>
                  {data.serie.map((s) => (
                    <tr key={s.fecha} style={{ cursor: 'default' }}>
                      <td>{diaCorto(s.fecha)}</td><td className="num">{s.ventas}</td><td className="num">{money(s.total)}</td><td className="num">{money(s.utilidad)}</td>
                      <td className="num">{money(s.gastos)}</td><td className={'num ' + (s.ganancia >= 0 ? 'dif-ok' : 'dif-mal')}>{money(s.ganancia)}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            </div>
          )}
        </>
      )}
    </>
  )
}
