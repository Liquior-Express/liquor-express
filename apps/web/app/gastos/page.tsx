'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { apiFetch } from '../../lib/api'
import { AppShell, useSesion } from '../../components/AppShell'
import { Modal } from '../../components/Modal'

interface Gasto { id: string; categoria: string; descripcion: string | null; valor: number; paga_con: string; fecha: string }
interface MovCM { id: string; tipo: 'gasto' | 'reposicion' | 'compra'; valor: number; concepto: string | null; origen: string | null; creado_en: string }
interface Arqueo { creado_en: string; usuario: { nombre: string } | null; detalle: { saldo_sistema: number; contado: number; diferencia: number; registrada: boolean } }
interface CajaMenor { saldo: number; movimientos: MovCM[]; arqueos: Arqueo[] }

const money = (n: number) => '$' + Math.round(Number(n) || 0).toLocaleString('es-CO')
const hoyLocal = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' })
const primerDiaMes = () => hoyLocal().slice(0, 8) + '01'
const CATEGORIAS: Record<string, string> = {
  arriendo: 'Arriendo', servicios: 'Servicios', nomina: 'Nómina', transporte: 'Transporte',
  mantenimiento: 'Mantenimiento', impuestos: 'Impuestos', otros: 'Otros',
}
// De la caja del día no sale plata: los gastos se pagan con la caja menor, Nequi o Bold.
const PAGA_CON: Record<string, string> = { caja_menor: 'Caja menor', nequi: 'Nequi', bold: 'Bold' }
// Incluye las formas de antes para leer el historial.
const PAGA_CON_LABEL: Record<string, string> = { ...PAGA_CON, caja: 'Caja del día', transferencia: 'Transferencia' }

export default function GastosPage() {
  return <AppShell active="gastos" titulo="Gastos y caja menor"><Gastos /></AppShell>
}

function Gastos() {
  const me = useSesion()
  const router = useRouter()
  useEffect(() => { if (me.usuario.rol === 'cajero') router.replace('/ventas') }, [me, router])

  const [rango, setRango] = useState({ desde: primerDiaMes(), hasta: hoyLocal() })
  const [lista, setLista] = useState<{ gastos: Gasto[]; total: number; por_categoria: Record<string, number> } | null>(null)
  const [cm, setCm] = useState<CajaMenor | null>(null)
  const [form, setForm] = useState({ categoria: 'servicios', descripcion: '', valor: '', paga_con: 'caja_menor', fecha: hoyLocal() })
  const [repo, setRepo] = useState({ valor: '', origen: 'transferencia' })
  // Conteo de la caja menor en curso (ventana propia).
  const [conteo, setConteo] = useState<{ contado: string; registrar: boolean } | null>(null)
  const [conteoError, setConteoError] = useState<string | null>(null)
  const [guardandoConteo, setGuardandoConteo] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null)

  const cargar = useCallback(async () => {
    const [g, c] = await Promise.all([
      apiFetch<any>(`/api/gastos?desde=${rango.desde}&hasta=${rango.hasta}`),
      apiFetch<CajaMenor>('/api/caja-menor'),
    ])
    setLista(g); setCm(c)
  }, [rango])
  useEffect(() => { cargar().catch((e) => setMsg({ ok: false, texto: e.message })) }, [cargar])

  async function registrar(e: React.FormEvent) {
    e.preventDefault(); setMsg(null)
    try {
      await apiFetch('/api/gastos', { method: 'POST', body: JSON.stringify({ ...form, valor: Number(form.valor) }) })
      setMsg({ ok: true, texto: `Gasto registrado: ${money(Number(form.valor))} (${CATEGORIAS[form.categoria]})` })
      setForm({ ...form, descripcion: '', valor: '' }); cargar()
    } catch (e: any) { setMsg({ ok: false, texto: e.message }) }
  }
  async function reponer(e: React.FormEvent) {
    e.preventDefault(); setMsg(null)
    try {
      await apiFetch('/api/caja-menor/reponer', { method: 'POST', body: JSON.stringify({ valor: Number(repo.valor), origen: repo.origen }) })
      setMsg({ ok: true, texto: `Caja menor repuesta con ${money(Number(repo.valor))}` })
      setRepo({ ...repo, valor: '' }); cargar()
    } catch (e: any) { setMsg({ ok: false, texto: e.message }) }
  }
  async function guardarConteo(e: React.FormEvent) {
    e.preventDefault()
    if (!conteo || conteo.contado === '') return
    setGuardandoConteo(true); setConteoError(null)
    try {
      const r = await apiFetch<{ diferencia: number; registrada: boolean }>('/api/caja-menor/arqueo', {
        method: 'POST', body: JSON.stringify({ contado: Number(conteo.contado), registrar: conteo.registrar }),
      })
      const texto = r.diferencia === 0
        ? 'Conteo guardado: la caja menor cuadra ✓'
        : 'Conteo guardado: ' + (r.diferencia > 0 ? 'sobraban ' : 'faltaban ') + money(Math.abs(r.diferencia)) + (r.registrada ? ' · diferencia registrada' : ' · solo anotado')
      setMsg({ ok: true, texto }); setConteo(null); cargar()
    } catch (err: any) { setConteoError(err.message) }
    finally { setGuardandoConteo(false) }
  }

  return (
    <>
      {msg && <div className={msg.ok ? 'aviso-ok' : 'alert'} style={{ marginBottom: 12 }}>{msg.texto}</div>}

      <Modal open={!!conteo} title="Contar caja menor" onClose={() => setConteo(null)}>
        {conteo && cm && (() => {
          const hayConteo = conteo.contado !== ''
          const diferencia = Math.round((Number(conteo.contado) || 0) - cm.saldo)
          return (
            <form className="form" style={{ marginTop: 0 }} onSubmit={guardarConteo}>
              <div className="row-between"><span className="muted">Saldo en el sistema</span><b>{money(cm.saldo)}</b></div>
              <div className="field"><label>¿Cuánto hay en el sobre? (contado)</label>
                <input autoFocus type="number" inputMode="numeric" min="0" value={conteo.contado} placeholder="0"
                  onChange={(e) => setConteo({ ...conteo, contado: e.target.value })} /></div>
              {hayConteo && (diferencia === 0
                ? <div className="dif-ok">Cuadra ✓</div>
                : (
                  <>
                    <div className={diferencia > 0 ? 'dif-ok' : 'dif-mal'}>{diferencia > 0 ? 'Sobran ' : 'Faltan '}{money(Math.abs(diferencia))}</div>
                    <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, lineHeight: 1.45 }}>
                      <input type="checkbox" checked={conteo.registrar} style={{ marginTop: 3 }}
                        onChange={(e) => setConteo({ ...conteo, registrar: e.target.checked })} />
                      <span>Registrar la diferencia y dejar el saldo en lo contado.{' '}
                        <span className="faint">{diferencia < 0 ? 'El faltante entra como gasto (Otros) y baja la ganancia.' : 'El sobrante se suma al saldo de la caja menor.'}</span></span>
                    </label>
                  </>
                ))}
              {conteoError && <div className="alert">{conteoError}</div>}
              <div style={{ display: 'flex', gap: 10 }}>
                <button type="button" className="btn ghost" style={{ flex: 1, marginTop: 0 }} onClick={() => setConteo(null)}>Cancelar</button>
                <button type="submit" className="btn" style={{ flex: 1, marginTop: 0 }} disabled={!hayConteo || guardandoConteo}>{guardandoConteo ? 'Guardando…' : 'Guardar conteo'}</button>
              </div>
            </form>
          )
        })()}
      </Modal>
      <div className="grid-2col">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <form className="card" onSubmit={registrar} style={{ maxWidth: 'none' }}>
            <h4 className="sub-modal">Nuevo gasto</h4>
            <div className="form" style={{ marginTop: 0 }}>
              <div className="grid2">
                <div className="field"><label>Categoría</label>
                  <select value={form.categoria} onChange={(e) => setForm({ ...form, categoria: e.target.value })}>
                    {Object.entries(CATEGORIAS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select></div>
                <div className="field"><label>Fecha</label><input type="date" value={form.fecha} onChange={(e) => setForm({ ...form, fecha: e.target.value })} /></div>
              </div>
              <div className="field"><label>Descripción (opcional)</label><input value={form.descripcion} placeholder="p. ej. Recibo de luz" onChange={(e) => setForm({ ...form, descripcion: e.target.value })} /></div>
              <div className="field"><label>Valor</label><input type="number" inputMode="numeric" value={form.valor} onChange={(e) => setForm({ ...form, valor: e.target.value })} required /></div>
              <div className="field"><label>Se paga con</label>
                <div className="segmento" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
                  {Object.entries(PAGA_CON).map(([k, l]) => <button key={k} type="button" className={form.paga_con === k ? 'activo' : ''} onClick={() => setForm({ ...form, paga_con: k })}>{l}</button>)}
                </div></div>
              <button className="btn" type="submit">Registrar gasto</button>
            </div>
          </form>

          <div className="card" style={{ maxWidth: 'none' }}>
            <div className="row-between"><h4 className="sub-modal" style={{ margin: 0 }}>Caja menor</h4>
              <span className="total-grande" style={{ margin: 0, fontSize: 26 }}>{cm ? money(cm.saldo) : '…'}</span></div>
            <form onSubmit={reponer} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8, alignItems: 'end', marginTop: 12 }}>
              <div className="field"><label>Reponer</label><input type="number" inputMode="numeric" value={repo.valor} onChange={(e) => setRepo({ ...repo, valor: e.target.value })} required /></div>
              <div className="field"><label>Desde</label>
                <input value="La cuenta (Nequi/Bold)" disabled /></div>
              <button className="btn" type="submit" style={{ marginTop: 0, height: 42 }}>Reponer</button>
            </form>
            <p className="faint" style={{ marginTop: 8, fontSize: 12.5 }}>El efectivo de la caja del día pasa aquí solo, al cerrar la caja.</p>
            <div className="row-between" style={{ marginTop: 10, gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="btn ghost" style={{ marginTop: 0 }}
                onClick={() => { setConteoError(null); setConteo({ contado: '', registrar: true }) }}>🧮 Contar caja menor</button>
              {cm?.arqueos?.[0] && (
                <span className="faint" style={{ fontSize: 12.5 }}>
                  Último conteo: {new Date(cm.arqueos[0].creado_en).toLocaleDateString('es-CO')} ·{' '}
                  {cm.arqueos[0].detalle.diferencia === 0
                    ? 'cuadró'
                    : (cm.arqueos[0].detalle.diferencia > 0 ? 'sobraban ' : 'faltaban ') + money(Math.abs(cm.arqueos[0].detalle.diferencia))}
                </span>
              )}
            </div>
            <div style={{ marginTop: 12, maxHeight: 220, overflowY: 'auto' }}>
              {cm?.movimientos.map((m) => (
                <div key={m.id} className="row-between" style={{ fontSize: 12.5, padding: '4px 0' }}>
                  <span>{m.concepto ?? (m.tipo === 'reposicion' ? 'Reposición' : 'Gasto')} <span className="faint">· {new Date(m.creado_en).toLocaleDateString('es-CO')}</span></span>
                  <b style={{ color: m.tipo === 'reposicion' ? 'var(--teal)' : 'var(--copper)' }}>{m.tipo === 'reposicion' ? '+' : '−'}{money(m.valor)}</b>
                </div>
              ))}
              {cm && cm.movimientos.length === 0 && <span className="faint">Sin movimientos. Repón la caja menor para empezar.</span>}
            </div>
          </div>
        </div>

        <div className="card" style={{ maxWidth: 'none' }}>
          <div className="toolbar" style={{ margin: '0 0 12px' }}>
            <input type="date" className="celda" style={{ width: 150 }} value={rango.desde} onChange={(e) => setRango({ ...rango, desde: e.target.value })} />
            <span className="faint">a</span>
            <input type="date" className="celda" style={{ width: 150 }} value={rango.hasta} onChange={(e) => setRango({ ...rango, hasta: e.target.value })} />
          </div>
          <div className="row-between"><h4 className="sub-modal" style={{ margin: 0 }}>Gastos del periodo</h4><b>{lista ? money(lista.total) : '…'}</b></div>
          {lista && Object.keys(lista.por_categoria).length > 0 && (
            <div className="pos-chips" style={{ margin: '10px 0' }}>
              {Object.entries(lista.por_categoria).map(([k, v]) => <span key={k} className="pos-chip" style={{ cursor: 'default' }}>{CATEGORIAS[k] ?? k} {money(v)}</span>)}
            </div>
          )}
          {lista?.gastos.map((g) => (
            <div key={g.id} className="row-between" style={{ fontSize: 13, padding: '7px 0', borderBottom: '1px solid var(--line)' }}>
              <span>{CATEGORIAS[g.categoria] ?? g.categoria}{g.descripcion && <span className="faint"> · {g.descripcion}</span>}
                <span className="faint" style={{ display: 'block', fontSize: 11 }}>{g.fecha} · {PAGA_CON_LABEL[g.paga_con] ?? g.paga_con}</span></span>
              <b>{money(g.valor)}</b>
            </div>
          ))}
          {lista && lista.gastos.length === 0 && <p className="faint">No hay gastos en este periodo.</p>}
        </div>
      </div>
    </>
  )
}
