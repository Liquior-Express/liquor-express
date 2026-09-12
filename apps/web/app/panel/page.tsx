'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { apiFetch } from '../../lib/api'
import { AppShell, useSesion, type Rol } from '../../components/AppShell'
import { useDialog } from '../../components/Dialog'

const ETIQUETA_ROL: Record<Rol, string> = { cajero: 'Caja', admin: 'Admin', gerencia: 'Gerencia' }
interface Usuario { id: string; usuario: string; nombre: string; rol: Rol; activo: boolean; ultima_actividad: string | null }
interface Inicio {
  hoy: { fecha: string; ventas: number; total: number; utilidad: number }
  mes: { desde: string; total: number; utilidad: number; gastos: number; ganancia_neta: number }
  caja: { abierta: boolean; fecha_jornada?: string; apertura?: string }
  tasa: number | null
  caja_menor: number
  alertas: { stock_bajo: number; stock_proximo: number; vencidos: number; por_vencer: number; por_pagar: { cantidad: number; total: number } }
}

const money = (n: number) => '$' + Math.round(Number(n) || 0).toLocaleString('es-CO')
const hora = (s: string) => new Date(s).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })
const diaCorto = (f: string) => new Date(f + 'T12:00:00').toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit' })

// En línea = actividad en los últimos 2,5 min (la app envía un latido cada minuto).
function presencia(u: Usuario): { online: boolean; texto: string } {
  if (!u.ultima_actividad) return { online: false, texto: 'desconectado' }
  const min = (Date.now() - new Date(u.ultima_actividad).getTime()) / 60000
  if (min < 2.5) return { online: true, texto: 'en línea' }
  if (min < 60) return { online: false, texto: `hace ${Math.round(min)} min` }
  if (min < 48 * 60) return { online: false, texto: `hace ${Math.round(min / 60)} h` }
  return { online: false, texto: new Date(u.ultima_actividad).toLocaleDateString('es-CO') }
}

export default function PanelPage() {
  return <AppShell active="inicio" titulo="Inicio"><PanelContenido /></AppShell>
}

function PanelContenido() {
  const me = useSesion()
  const router = useRouter()
  const dialog = useDialog()
  // Caja no entra a Inicio: su trabajo está en Ventas, Caja e Historial.
  useEffect(() => { if (me.usuario.rol === 'cajero') router.replace('/ventas') }, [me, router])

  const [inicio, setInicio] = useState<Inicio | null>(null)
  const [usuarios, setUsuarios] = useState<Usuario[]>([])
  const [form, setForm] = useState({ usuario: '', nombre: '', password: '', rol: 'cajero' as Rol })
  const [msg, setMsg] = useState<string | null>(null)
  const [respaldando, setRespaldando] = useState(false)

  const cargarUsuarios = useCallback(async () => {
    try { const r = await apiFetch<{ usuarios: Usuario[] }>('/api/usuarios'); setUsuarios(r.usuarios) } catch {}
  }, [])
  // Conectados y resumen: se refrescan solos cada 15 s.
  useEffect(() => {
    const cargar = () => {
      cargarUsuarios()
      apiFetch<Inicio>('/api/inicio').then(setInicio).catch(() => {})
    }
    cargar()
    const t = setInterval(cargar, 15_000)
    return () => clearInterval(t)
  }, [cargarUsuarios])

  async function crearUsuario(e: React.FormEvent) {
    e.preventDefault(); setMsg(null)
    try {
      await apiFetch('/api/usuarios', { method: 'POST', body: JSON.stringify(form) })
      setMsg(`Usuario "${form.usuario}" creado`)
      setForm({ usuario: '', nombre: '', password: '', rol: 'cajero' })
      cargarUsuarios()
    } catch (e: any) { setMsg(e.message ?? 'No se pudo crear') }
  }
  async function alternarActivo(u: Usuario) {
    try { await apiFetch(`/api/usuarios/${u.id}`, { method: 'PATCH', body: JSON.stringify({ activo: !u.activo }) }); cargarUsuarios() }
    catch (e: any) { setMsg(e.message) }
  }
  async function cambiarRol(u: Usuario) {
    const rol = await dialog.pedir({ title: `Rol de ${u.usuario}`, label: 'Escribe: caja, admin o gerencia', initial: u.rol === 'cajero' ? 'caja' : u.rol, confirmText: 'Guardar' })
    if (!rol) return
    const limpio = rol.trim().toLowerCase()
    const nuevo = limpio === 'caja' || limpio === 'cajero' ? 'cajero' : limpio === 'admin' ? 'admin' : limpio === 'gerencia' ? 'gerencia' : null
    if (!nuevo) { setMsg('Rol inválido. Usa: caja, admin o gerencia.'); return }
    try { await apiFetch(`/api/usuarios/${u.id}`, { method: 'PATCH', body: JSON.stringify({ rol: nuevo }) }); cargarUsuarios() }
    catch (e: any) { setMsg(e.message) }
  }
  async function eliminar(u: Usuario) {
    const ok = await dialog.confirmar({ title: 'Eliminar usuario', message: `¿Seguro que quieres eliminar a "${u.usuario}"? Esta acción no se puede deshacer.`, confirmText: 'Eliminar', peligro: true })
    if (!ok) return
    try { await apiFetch(`/api/usuarios/${u.id}`, { method: 'DELETE' }); cargarUsuarios() } catch (e: any) { setMsg(e.message) }
  }
  async function restablecerClave(u: Usuario) {
    const nueva = await dialog.pedir({ title: `Nueva contraseña · ${u.usuario}`, label: 'Contraseña (mín. 4)', type: 'password', min: 4, confirmText: 'Guardar' })
    if (!nueva) return
    try { await apiFetch(`/api/usuarios/${u.id}`, { method: 'PATCH', body: JSON.stringify({ password: nueva }) }); setMsg(`Contraseña de "${u.usuario}" actualizada`) }
    catch (e: any) { setMsg(e.message) }
  }
  async function descargarRespaldo() {
    setRespaldando(true); setMsg(null)
    try {
      const r = await fetch('/api/respaldo', { headers: { Authorization: `Bearer ${localStorage.getItem('le_token') ?? ''}` } })
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error ?? 'No se pudo generar el respaldo')
      const url = URL.createObjectURL(await r.blob())
      const a = document.createElement('a')
      a.href = url
      a.download = `respaldo-liquor-express-${new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' })}.json`
      a.click(); URL.revokeObjectURL(url)
      setMsg('Respaldo descargado. Guárdalo en un lugar seguro (USB o nube).')
    } catch (e: any) { setMsg(e.message) } finally { setRespaldando(false) }
  }

  const enLinea = usuarios.filter((u) => presencia(u).online).length
  const a = inicio?.alertas

  return (
    <>
      {/* Saludo */}
      <div className="row-between" style={{ flexWrap: 'wrap', gap: 10, marginBottom: 4 }}>
        <span>
          <b style={{ fontFamily: 'Fraunces,serif', fontSize: 22, fontWeight: 500 }}>Hola, {me.usuario.nombre}</b>
          <span className="faint" style={{ display: 'block', marginTop: 2 }}>
            {me.ve_utilidad ? 'Acceso a utilidad y reportes financieros.' : 'Acceso de caja (sin utilidad).'}
          </span>
        </span>
        <span className="badge">{ETIQUETA_ROL[me.usuario.rol]}</span>
      </div>
      {msg && <div className="alert" style={{ margin: '12px 0' }}>{msg}</div>}

      {/* 1 · Resumen del negocio */}
      <div className="seccion-rep" style={{ marginTop: 18 }}>
        <h3>Resumen</h3>
        {!inicio ? <p className="faint">Cargando…</p> : (
          <>
            <div className="tiles" style={{ marginTop: 0 }}>
              <div className="tile"><div className="t">Ventas de hoy</div><div className="v">{money(inicio.hoy.total)}</div>
                <div className="s">{inicio.hoy.ventas} venta(s){me.ve_utilidad && <> · utilidad {money(inicio.hoy.utilidad)}</>}</div></div>
              <div className="tile"><div className="t">Caja</div>
                <div className={'v ' + (inicio.caja.abierta ? 'dif-ok' : '')} style={{ fontSize: 19 }}>{inicio.caja.abierta ? 'Abierta' : 'Cerrada'}</div>
                <div className="s">{inicio.caja.abierta
                  ? <>Jornada {diaCorto(inicio.caja.fecha_jornada!)} · desde {hora(inicio.caja.apertura!)}</>
                  : <a href="/caja">Abrir caja para vender</a>}</div></div>
              <div className="tile"><div className="t">Ganancia del mes</div>
                <div className={'v ' + (inicio.mes.ganancia_neta >= 0 ? 'dif-ok' : 'dif-mal')}>{money(inicio.mes.ganancia_neta)}</div>
                <div className="s">Ventas {money(inicio.mes.total)} · gastos {money(inicio.mes.gastos)}</div></div>
              <div className="tile"><div className="t">Caja menor</div><div className="v">{money(inicio.caja_menor)}</div>
                <div className="s">Tasa del Real: {inicio.tasa ? money(inicio.tasa) : <a href="/ventas">sin registrar hoy</a>}</div></div>
            </div>

            {/* Alertas con enlace directo a donde se resuelven */}
            <div className="pos-chips" style={{ marginTop: 4 }}>
              {a!.stock_bajo > 0 && <a className="pos-chip" href="/inventario">⚠ {a!.stock_bajo} con stock bajo</a>}
              {a!.stock_proximo > 0 && <a className="pos-chip" href="/reportes">🛒 {a!.stock_proximo} por pedir pronto</a>}
              {a!.vencidos > 0 && <a className="pos-chip" href="/reportes">⛔ {a!.vencidos} lote(s) vencido(s)</a>}
              {a!.por_vencer > 0 && <a className="pos-chip" href="/reportes">🕒 {a!.por_vencer} por vencer (30 días)</a>}
              {a!.por_pagar.cantidad > 0 && <a className="pos-chip" href="/compras">💳 {a!.por_pagar.cantidad} compra(s) por pagar · {money(a!.por_pagar.total)}</a>}
              {a!.stock_bajo === 0 && a!.vencidos === 0 && a!.por_vencer === 0 && a!.por_pagar.cantidad === 0 && <span className="faint">Sin alertas pendientes 👌</span>}
            </div>
          </>
        )}
      </div>

      <div className="grid-2col" style={{ marginTop: 22 }}>
        {/* 2 · Usuarios y quién está conectado */}
        <div className="card" style={{ maxWidth: 'none' }}>
          <div className="row-between" style={{ marginBottom: 12 }}>
            <h4 className="sub-modal" style={{ margin: 0 }}>Usuarios del sistema</h4>
            <span className="faint"><span className="punto-online" /> {enLinea} en línea</span>
          </div>
          {usuarios.map((u) => {
            const pr = presencia(u)
            return (
              <div key={u.id} className="row-between" style={{ fontSize: 13.5, gap: 8, padding: '7px 0', borderBottom: '1px solid var(--line)' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  <span className={'punto-online' + (pr.online ? '' : ' off')} title={pr.texto} />
                  <span>{u.nombre} <span className="faint">· {u.usuario}</span>{!u.activo && <span className="faint"> (inactivo)</span>}
                    <span className="faint" style={{ display: 'block', fontSize: 11 }}>{ETIQUETA_ROL[u.rol]} · {pr.texto}</span></span>
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}>
                  <button className="link-btn" title="Cambiar rol" onClick={() => cambiarRol(u)}>👤</button>
                  <button className="link-btn" title="Restablecer contraseña" onClick={() => restablecerClave(u)}>🔑</button>
                  <button className="link-btn" title={u.activo ? 'Desactivar' : 'Activar'} onClick={() => alternarActivo(u)}>{u.activo ? '⏸' : '▶'}</button>
                  {u.id !== me.usuario.id && <button className="link-btn" title="Eliminar" onClick={() => eliminar(u)}>✕</button>}
                </span>
              </div>
            )
          })}
          {usuarios.length === 0 && <span className="faint">Cargando usuarios…</span>}
          <p className="faint" style={{ marginTop: 10, fontSize: 11.5 }}>👤 rol · 🔑 contraseña · ⏸ activar/desactivar · ✕ eliminar</p>
        </div>

        {/* 3 · Crear usuario */}
        <div className="card" style={{ maxWidth: 'none' }}>
          <h4 className="sub-modal">Crear usuario</h4>
          <form className="form" onSubmit={crearUsuario} style={{ marginTop: 0 }}>
            <div className="grid2">
              <div className="field"><label>Usuario (corto)</label>
                <input value={form.usuario} placeholder="caja" autoCapitalize="none" onChange={(e) => setForm({ ...form, usuario: e.target.value })} required /></div>
              <div className="field"><label>Nombre visible</label>
                <input value={form.nombre} placeholder="Caja" onChange={(e) => setForm({ ...form, nombre: e.target.value })} /></div>
            </div>
            <div className="grid2">
              <div className="field"><label>Contraseña (mín. 4)</label>
                <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required /></div>
              <div className="field"><label>Rol</label>
                <select value={form.rol} onChange={(e) => setForm({ ...form, rol: e.target.value as Rol })}>
                  <option value="cajero">Caja</option><option value="admin">Admin</option><option value="gerencia">Gerencia</option>
                </select></div>
            </div>
            <button className="btn" type="submit">Crear usuario</button>
          </form>
          <p className="faint" style={{ marginTop: 12, lineHeight: 1.5 }}>
            <b>Caja</b> ve Ventas rápidas, Caja e Historial (sin costos ni utilidad).<br />
            <b>Admin</b> y <b>Gerencia</b> ven todo: inventario, compras, gastos, reportes y bitácora.
          </p>
          {me.usuario.rol === 'admin' && (
            <button className="btn ghost" style={{ width: '100%', marginTop: 14 }} onClick={descargarRespaldo} disabled={respaldando}>
              {respaldando ? 'Preparando respaldo…' : '⬇ Descargar respaldo de los datos'}
            </button>
          )}
        </div>
      </div>
    </>
  )
}
