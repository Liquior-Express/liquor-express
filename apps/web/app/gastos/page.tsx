'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { apiFetch } from '../../lib/api'
import { AppShell, useSesion } from '../../components/AppShell'

interface Gasto { id: string; categoria: string; descripcion: string | null; valor: number; paga_con: string; fecha: string }
interface MovCM { id: string; tipo: 'gasto' | 'reposicion'; valor: number; concepto: string | null; origen: string | null; creado_en: string }

const money = (n: number) => '$' + Math.round(Number(n) || 0).toLocaleString('es-CO')
const hoyLocal = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' })
const primerDiaMes = () => hoyLocal().slice(0, 8) + '01'
const CATEGORIAS: Record<string, string> = {
  arriendo: 'Arriendo', servicios: 'Servicios', nomina: 'Nómina', transporte: 'Transporte',
  mantenimiento: 'Mantenimiento', impuestos: 'Impuestos', otros: 'Otros',
}
const PAGA_CON: Record<string, string> = { caja: 'Caja del día', caja_menor: 'Caja menor', transferencia: 'Transferencia' }

export default function GastosPage() {
  return <AppShell active="gastos" titulo="Gastos y caja menor"><Gastos /></AppShell>
}

function Gastos() {
  const me = useSesion()
  const router = useRouter()
  useEffect(() => { if (me.usuario.rol === 'cajero') router.replace('/ventas') }, [me, router])

  const [rango, setRango] = useState({ desde: primerDiaMes(), hasta: hoyLocal() })
  const [lista, setLista] = useState<{ gastos: Gasto[]; total: number; por_categoria: Record<string, number> } | null>(null)
  const [cm, setCm] = useState<{ saldo: number; movimientos: MovCM[] } | null>(null)
  const [form, setForm] = useState({ categoria: 'servicios', descripcion: '', valor: '', paga_con: 'caja', fecha: hoyLocal() })
  const [repo, setRepo] = useState({ valor: '', origen: 'transferencia' })
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null)

  const cargar = useCallback(async () => {
    const [g, c] = await Promise.all([
      apiFetch<any>(`/api/gastos?desde=${rango.desde}&hasta=${rango.hasta}`),
      apiFetch<{ saldo: number; movimientos: MovCM[] }>('/api/caja-menor'),
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

  return (
    <>
      {msg && <div className={msg.ok ? 'aviso-ok' : 'alert'} style={{ marginBottom: 12 }}>{msg.texto}</div>}
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
                <select value={repo.origen} onChange={(e) => setRepo({ ...repo, origen: e.target.value })}>
                  <option value="transferencia">Transferencia</option><option value="caja">Caja del día</option>
                </select></div>
              <button className="btn" type="submit" style={{ marginTop: 0, height: 42 }}>Reponer</button>
            </form>
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
                <span className="faint" style={{ display: 'block', fontSize: 11 }}>{g.fecha} · {PAGA_CON[g.paga_con]}</span></span>
              <b>{money(g.valor)}</b>
            </div>
          ))}
          {lista && lista.gastos.length === 0 && <p className="faint">No hay gastos en este periodo.</p>}
        </div>
      </div>
    </>
  )
}
