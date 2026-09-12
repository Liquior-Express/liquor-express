'use client'

import { useEffect, useState, useCallback } from 'react'
import { apiFetch } from '../../lib/api'
import { AppShell, useSesion } from '../../components/AppShell'
import { Modal } from '../../components/Modal'
import { useDialog } from '../../components/Dialog'

interface Movimiento { id: string; tipo: 'ingreso' | 'egreso'; concepto: string; valor: number; creado_en: string }
interface Resumen {
  ventas: { cantidad: number; total: number; utilidad?: number }
  por_medio: { efectivo: number; efectivo_reales: { pesos: number; reales: number }; nequi: number; bold: number; pix: { pesos: number; reales: number } }
  ingresos: number; egresos: number; movimientos: Movimiento[]
  esperado_efectivo: number; esperado_reales: number
}
interface Actual {
  abierta: boolean; tasa: number | null
  sesion?: { id: string; fecha_jornada: string; apertura: string; base_apertura: number; base_reales: number; abierta_por: string | null }
  resumen?: Resumen
}
interface Sesion {
  id: string; fecha_jornada: string; apertura: string; cierre: string; total_ventas: number; esperado_caja: number; contado_efectivo: number
  diferencia: number; esperado_reales: number; contado_reales: number; diferencia_reales: number; observaciones: string | null
}

const money = (n: number) => '$' + Math.round(Number(n) || 0).toLocaleString('es-CO')
const reales = (n: number) => 'R$ ' + (Number(n) || 0).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const hoyLocal = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' })
const haceDias = (n: number) => new Date(Date.now() - n * 864e5).toLocaleDateString('en-CA', { timeZone: 'America/Bogota' })
const fechaHora = (s: string) => new Date(s).toLocaleString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
const jornadaLarga = (f: string) => new Date(f + 'T12:00:00').toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
const jornadaCorta = (f: string) => new Date(f + 'T12:00:00').toLocaleDateString('es-CO', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })

function Diferencia({ valor, esReales = false }: { valor: number; esReales?: boolean }) {
  const f = esReales ? reales : money
  if (Math.abs(valor) < (esReales ? 0.01 : 1)) return <span className="dif-ok">Cuadra ✓</span>
  return <span className={valor > 0 ? 'dif-ok' : 'dif-mal'}>{valor > 0 ? `Sobran ${f(valor)}` : `Faltan ${f(-valor)}`}</span>
}

export default function CajaPage() {
  return <AppShell active="caja" titulo="Caja"><Caja /></AppShell>
}

function Caja() {
  const me = useSesion()
  const dialog = useDialog()
  const gestor = me.usuario.rol !== 'cajero'

  const [actual, setActual] = useState<Actual | null>(null)
  const [historial, setHistorial] = useState<Sesion[]>([])
  const [rango, setRango] = useState({ desde: haceDias(29), hasta: hoyLocal() })
  const [base, setBase] = useState({ pesos: '', reales: '', jornada: hoyLocal() })
  const [cerrando, setCerrando] = useState(false)
  const [conteo, setConteo] = useState({ pesos: '', reales: '', obs: '' })
  const [ultimoCierre, setUltimoCierre] = useState<any>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setActual(await apiFetch<Actual>('/api/caja/actual'))
    if (gestor) setHistorial((await apiFetch<{ sesiones: Sesion[] }>(`/api/caja/historial?desde=${rango.desde}&hasta=${rango.hasta}`)).sesiones)
  }, [gestor, rango])
  useEffect(() => {
    cargar().catch((e) => setMsg(e.message))
    const t = setInterval(() => cargar().catch(() => {}), 30_000) // totales en vivo
    return () => clearInterval(t)
  }, [cargar])

  async function abrir(e: React.FormEvent) {
    e.preventDefault(); setMsg(null)
    try {
      await apiFetch('/api/caja/abrir', { method: 'POST', body: JSON.stringify({ base: Number(base.pesos) || 0, base_reales: Number(base.reales) || 0, fecha_jornada: base.jornada }) })
      setBase({ pesos: '', reales: '', jornada: hoyLocal() }); setUltimoCierre(null); await cargar()
    } catch (e: any) { setMsg(e.message) }
  }

  async function movimiento(tipo: 'ingreso' | 'egreso') {
    const titulo = tipo === 'ingreso' ? 'Entrada de efectivo' : 'Salida de efectivo'
    const concepto = await dialog.pedir({ title: titulo, label: 'Concepto', placeholder: tipo === 'ingreso' ? 'p. ej. Base adicional' : 'p. ej. Compra de hielo', confirmText: 'Siguiente' })
    if (!concepto) return
    const valor = await dialog.pedir({ title: `${titulo} · ${concepto}`, label: 'Valor en pesos', type: 'number', confirmText: 'Registrar' })
    if (!valor) return
    try { await apiFetch('/api/caja/movimiento', { method: 'POST', body: JSON.stringify({ tipo, concepto, valor: Number(valor) }) }); await cargar() }
    catch (e: any) { setMsg(e.message) }
  }

  async function cerrar(e: React.FormEvent) {
    e.preventDefault(); setMsg(null)
    try {
      const r = await apiFetch<{ cierre: any }>('/api/caja/cerrar', {
        method: 'POST', body: JSON.stringify({ contado_efectivo: conteo.pesos, contado_reales: Number(conteo.reales) || 0, observaciones: conteo.obs }),
      })
      setUltimoCierre(r.cierre); setCerrando(false); setConteo({ pesos: '', reales: '', obs: '' }); await cargar()
    } catch (e: any) { setMsg(e.message) }
  }

  if (!actual) return <p className="muted">{msg ?? 'Cargando caja…'}</p>
  const r = actual.resumen

  return (
    <div style={{ maxWidth: 940 }}>
      {msg && <div className="alert" style={{ marginBottom: 12 }}>{msg}</div>}

      {ultimoCierre && (
        <div className="card" style={{ maxWidth: 'none', marginBottom: 18 }}>
          <div className="row-between">
            <h3 className="sub-modal" style={{ margin: 0 }}>Cierre registrado · jornada del {jornadaLarga(ultimoCierre.fecha_jornada)}</h3>
            <button className="link-btn" onClick={() => setUltimoCierre(null)}>✕</button>
          </div>
          <p className="faint" style={{ marginTop: 4 }}>Apertura {fechaHora(ultimoCierre.apertura)} · Cierre {fechaHora(ultimoCierre.cierre)}</p>
          <div className="tiles">
            <div className="tile"><div className="t">Ventas</div><div className="v">{money(ultimoCierre.total_ventas)}</div></div>
            <div className="tile"><div className="t">Efectivo esperado</div><div className="v">{money(ultimoCierre.esperado_caja)}</div>
              <div className="s">Contado {money(ultimoCierre.contado_efectivo)} · <Diferencia valor={ultimoCierre.diferencia} /></div></div>
            <div className="tile"><div className="t">Reales esperados</div><div className="v">{reales(ultimoCierre.esperado_reales)}</div>
              <div className="s">Contado {reales(ultimoCierre.contado_reales)} · <Diferencia valor={ultimoCierre.diferencia_reales} esReales /></div></div>
            <div className="tile"><div className="t">Nequi · Bold · PIX</div><div className="v" style={{ fontSize: 16 }}>{money(ultimoCierre.total_nequi)} · {money(ultimoCierre.total_bold)} · {money(ultimoCierre.total_pix)}</div></div>
          </div>
        </div>
      )}

      {!actual.abierta ? (
        <form className="card" onSubmit={abrir} style={{ maxWidth: 460 }}>
          <h3 style={{ fontFamily: 'Fraunces,serif', fontWeight: 500, fontSize: 22 }}>Abrir caja</h3>
          <p className="hint" style={{ textAlign: 'left' }}>Para vender, la caja debe estar abierta. Escribe el dinero con el que empiezas.</p>
          <div className="form">
            <div className="field"><label>Fecha de la jornada</label>
              <input type="date" value={base.jornada} onChange={(e) => setBase({ ...base, jornada: e.target.value })} required />
              <div className="sugerido">Las ventas de esta caja cuentan para este día, aunque se cierre después de medianoche.</div></div>
            <div className="field"><label>Base en pesos</label>
              <input type="number" inputMode="numeric" value={base.pesos} onChange={(e) => setBase({ ...base, pesos: e.target.value })} placeholder="0" /></div>
            <div className="field"><label>Base en reales (opcional)</label>
              <input type="number" inputMode="decimal" step="0.01" value={base.reales} onChange={(e) => setBase({ ...base, reales: e.target.value })} placeholder="0" /></div>
            <button className="btn" type="submit">Abrir caja</button>
          </div>
        </form>
      ) : r && actual.sesion && (
        <>
          <div className="row-between" style={{ flexWrap: 'wrap', gap: 10 }}>
            <span>
              <b style={{ fontFamily: 'Fraunces,serif', fontSize: 18, fontWeight: 500 }}>Jornada del {jornadaLarga(actual.sesion.fecha_jornada)}</b>
              <span className="faint" style={{ display: 'block', marginTop: 2 }}>
                Abierta el {fechaHora(actual.sesion.apertura)}{actual.sesion.abierta_por && <> por {actual.sesion.abierta_por}</>} · base {money(actual.sesion.base_apertura)}{actual.sesion.base_reales > 0 && <> + {reales(actual.sesion.base_reales)}</>}
              </span>
            </span>
            <span style={{ display: 'flex', gap: 8 }}>
              <button className="btn ghost" style={{ marginTop: 0 }} onClick={() => movimiento('ingreso')}>＋ Entrada</button>
              <button className="btn ghost" style={{ marginTop: 0 }} onClick={() => movimiento('egreso')}>− Salida</button>
              <button className="btn" style={{ marginTop: 0 }} onClick={() => { setMsg(null); setCerrando(true) }}>Cerrar caja</button>
            </span>
          </div>

          <div className="tiles">
            <div className="tile"><div className="t">Ventas ({r.ventas.cantidad})</div><div className="v">{money(r.ventas.total)}</div>
              {r.ventas.utilidad !== undefined && <div className="s">Utilidad {money(r.ventas.utilidad)}</div>}</div>
            <div className="tile"><div className="t">Efectivo en caja (pesos)</div><div className="v">{money(r.esperado_efectivo)}</div>
              <div className="s">Ventas {money(r.por_medio.efectivo)}{(r.ingresos > 0 || r.egresos > 0) && <> · +{money(r.ingresos)} / −{money(r.egresos)}</>}</div></div>
            <div className="tile"><div className="t">Reales en caja</div><div className="v">{reales(r.esperado_reales)}</div>
              <div className="s">Ventas en reales {money(r.por_medio.efectivo_reales.pesos)}</div></div>
            <div className="tile"><div className="t">Nequi</div><div className="v">{money(r.por_medio.nequi)}</div></div>
            <div className="tile"><div className="t">Bold</div><div className="v">{money(r.por_medio.bold)}</div></div>
            <div className="tile"><div className="t">PIX</div><div className="v">{money(r.por_medio.pix.pesos)}</div><div className="s">{reales(r.por_medio.pix.reales)}</div></div>
          </div>

          {r.movimientos.length > 0 && (
            <div className="card" style={{ maxWidth: 'none', padding: '16px 20px' }}>
              <h4 className="sub-modal">Entradas y salidas de efectivo</h4>
              {r.movimientos.map((m) => (
                <div key={m.id} className="row-between" style={{ fontSize: 13, padding: '4px 0' }}>
                  <span>{m.concepto} <span className="faint">· {fechaHora(m.creado_en)}</span></span>
                  <b style={{ color: m.tipo === 'ingreso' ? 'var(--teal)' : 'var(--copper)' }}>{m.tipo === 'ingreso' ? '+' : '−'}{money(m.valor)}</b>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {gestor && (
        <>
          <div className="row-between" style={{ marginTop: 26, flexWrap: 'wrap', gap: 10 }}>
            <h4 className="sub-modal" style={{ margin: 0 }}>Cierres de caja</h4>
            <span className="toolbar" style={{ margin: 0 }}>
              <input type="date" className="celda" style={{ width: 150 }} value={rango.desde} onChange={(e) => setRango({ ...rango, desde: e.target.value })} />
              <span className="faint">a</span>
              <input type="date" className="celda" style={{ width: 150 }} value={rango.hasta} onChange={(e) => setRango({ ...rango, hasta: e.target.value })} />
            </span>
          </div>
          <div className="tabla-wrap" style={{ marginTop: 10 }}>
            <table className="tabla" style={{ minWidth: 760 }}>
              <thead><tr><th>Jornada</th><th>Apertura</th><th>Cierre</th><th className="num">Ventas</th><th className="num">Efectivo esperado</th><th className="num">Contado</th><th>Diferencia</th><th>Reales</th></tr></thead>
              <tbody>
                {historial.map((s) => (
                  <tr key={s.id} style={{ cursor: 'default' }} title={s.observaciones ?? ''}>
                    <td><b>{jornadaCorta(s.fecha_jornada)}</b></td>
                    <td className="faint">{fechaHora(s.apertura)}</td>
                    <td className="faint">{fechaHora(s.cierre)}</td>
                    <td className="num">{money(s.total_ventas)}</td>
                    <td className="num">{money(s.esperado_caja)}</td>
                    <td className="num">{money(s.contado_efectivo)}</td>
                    <td><Diferencia valor={Number(s.diferencia)} /></td>
                    <td><Diferencia valor={Number(s.diferencia_reales)} esReales /></td>
                  </tr>
                ))}
                {historial.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--faint)', padding: 20 }}>No hay cierres en estas fechas.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      <Modal open={cerrando} title="Cerrar caja" onClose={() => setCerrando(false)} ancho={460}>
        {r && actual.sesion && (
          <form className="form" style={{ marginTop: 0 }} onSubmit={cerrar}>
            <p className="muted">Jornada del <b>{jornadaLarga(actual.sesion.fecha_jornada)}</b>. Cuenta el dinero del cajón y escríbelo; el sistema calcula si cuadra.</p>
            <div className="field"><label>Efectivo contado en pesos · esperado {money(r.esperado_efectivo)}</label>
              <input type="number" inputMode="numeric" autoFocus value={conteo.pesos} onChange={(e) => setConteo({ ...conteo, pesos: e.target.value })} required /></div>
            {conteo.pesos !== '' && <Diferencia valor={Number(conteo.pesos) - r.esperado_efectivo} />}
            <div className="field"><label>Reales contados · esperado {reales(r.esperado_reales)}</label>
              <input type="number" inputMode="decimal" step="0.01" value={conteo.reales} onChange={(e) => setConteo({ ...conteo, reales: e.target.value })} placeholder="0" /></div>
            {(conteo.reales !== '' || r.esperado_reales > 0) && <Diferencia valor={(Number(conteo.reales) || 0) - r.esperado_reales} esReales />}
            <div className="field"><label>Observaciones (opcional)</label>
              <input value={conteo.obs} onChange={(e) => setConteo({ ...conteo, obs: e.target.value })} /></div>
            {msg && <div className="alert">{msg}</div>}
            <button className="btn" type="submit">Confirmar cierre</button>
          </form>
        )}
      </Modal>
    </div>
  )
}
