'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { apiFetch } from '../../lib/api'
import { AppShell, useSesion } from '../../components/AppShell'

interface Dia { fecha: string; ventas: number; otros_ingresos: number; compras: number; gastos: number; caja_menor: number; otros_egresos: number; entradas: number; salidas: number; neto: number; acumulado: number }
interface Flujo { desde: string; hasta: string; dias: Dia[]; totales: Record<string, number>; por_medio: Record<string, number> }

const money = (n: number) => '$' + Math.round(Number(n) || 0).toLocaleString('es-CO')
const fmtDia = (f: string) => new Date(f + 'T12:00:00').toLocaleDateString('es-CO', { weekday: 'short', day: '2-digit', month: '2-digit' })
const hoyLocal = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' })
const MEDIO: Record<string, string> = { efectivo: 'Efectivo', nequi: 'Nequi', bold: 'Bold', pix: 'PIX' }

// Atajos de periodo (fechas de Colombia).
function periodo(tipo: 'hoy' | 'semana' | 'mes' | 'mes_pasado') {
  const h = hoyLocal()
  const d = new Date(h + 'T12:00:00')
  const iso = (x: Date) => x.toISOString().slice(0, 10)
  if (tipo === 'hoy') return { desde: h, hasta: h }
  if (tipo === 'semana') { const l = new Date(d); l.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return { desde: iso(l), hasta: h } }
  if (tipo === 'mes') return { desde: h.slice(0, 8) + '01', hasta: h }
  const ini = new Date(d.getFullYear(), d.getMonth() - 1, 1, 12)
  const fin = new Date(d.getFullYear(), d.getMonth(), 0, 12)
  return { desde: iso(ini), hasta: iso(fin) }
}

export default function FlujoPage() {
  return <AppShell active="flujo" titulo="Flujo de caja"><FlujoContenido /></AppShell>
}

function FlujoContenido() {
  const me = useSesion()
  const router = useRouter()
  useEffect(() => { if (me.usuario.rol === 'cajero') router.replace('/ventas') }, [me, router])

  const [rango, setRango] = useState(periodo('mes'))
  const [data, setData] = useState<Flujo | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setData(await apiFetch<Flujo>(`/api/flujo?desde=${rango.desde}&hasta=${rango.hasta}`))
  }, [rango])
  useEffect(() => { cargar().catch((e) => setMsg(e.message)) }, [cargar])

  const t = data?.totales
  return (
    <>
      <div className="toolbar" style={{ marginTop: 0 }}>
        {([['hoy', 'Hoy'], ['semana', 'Esta semana'], ['mes', 'Este mes'], ['mes_pasado', 'Mes pasado']] as const).map(([k, l]) => (
          <button key={k} className="pos-chip" style={{ fontSize: 12, padding: '6px 11px' }} onClick={() => setRango(periodo(k))}>{l}</button>
        ))}
        <input type="date" className="celda" style={{ width: 150 }} value={rango.desde} onChange={(e) => setRango({ ...rango, desde: e.target.value })} />
        <span className="faint">a</span>
        <input type="date" className="celda" style={{ width: 150 }} value={rango.hasta} onChange={(e) => setRango({ ...rango, hasta: e.target.value })} />
      </div>
      {msg && <div className="alert" style={{ marginBottom: 12 }}>{msg}</div>}

      {t && (
        <div className="tiles" style={{ marginTop: 0 }}>
          <div className="tile"><div className="t">Entradas</div><div className="v dif-ok">{money(t.entradas)}</div>
            <div className="s">Ventas {money(t.ventas)}{t.otros_ingresos ? ` · otros ${money(t.otros_ingresos)}` : ''}</div></div>
          <div className="tile"><div className="t">Salidas</div><div className="v dif-mal">{money(t.salidas)}</div>
            <div className="s">Compras {money(t.compras)} · gastos {money(t.gastos)}</div></div>
          <div className="tile"><div className="t">Caja menor · otros</div><div className="v" style={{ fontSize: 18 }}>{money(t.caja_menor)} · {money(t.otros_egresos)}</div></div>
          <div className="tile"><div className="t">Saldo del periodo</div><div className={'v ' + (t.neto >= 0 ? 'dif-ok' : 'dif-mal')}>{money(t.neto)}</div></div>
        </div>
      )}
      {data && Object.keys(data.por_medio).length > 0 && (
        <div className="pos-chips" style={{ marginBottom: 14 }}>
          {Object.entries(data.por_medio).map(([k, v]) => <span key={k} className="pos-chip" style={{ cursor: 'default' }}>Ventas {MEDIO[k] ?? k}: {money(v)}</span>)}
        </div>
      )}

      <div className="tabla-wrap">
        <table className="tabla" style={{ minWidth: 860 }}>
          <thead><tr>
            <th>Día</th><th className="num">Ventas</th><th className="num">Otros ingresos</th><th className="num">Compras</th>
            <th className="num">Gastos</th><th className="num">Caja menor</th><th className="num">Otras salidas</th><th className="num">Neto</th><th className="num">Acumulado</th>
          </tr></thead>
          <tbody>
            {data?.dias.map((d) => (
              <tr key={d.fecha} style={{ cursor: 'default' }}>
                <td>{fmtDia(d.fecha)}</td>
                <td className="num">{money(d.ventas)}</td><td className="num">{money(d.otros_ingresos)}</td>
                <td className="num">{money(d.compras)}</td><td className="num">{money(d.gastos)}</td>
                <td className="num">{money(d.caja_menor)}</td><td className="num">{money(d.otros_egresos)}</td>
                <td className={'num ' + (d.neto >= 0 ? 'dif-ok' : 'dif-mal')}>{money(d.neto)}</td>
                <td className="num"><b>{money(d.acumulado)}</b></td>
              </tr>
            ))}
            {data && data.dias.length === 0 && <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--faint)', padding: 24 }}>Sin movimientos de dinero en este periodo.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="faint" style={{ marginTop: 10 }}>Entradas: ventas de todos los medios y entradas manuales de caja. Salidas: compras pagadas, gastos, reposiciones de caja menor y salidas manuales de caja.</p>
    </>
  )
}
