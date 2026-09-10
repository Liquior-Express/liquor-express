'use client'

import { useEffect, useState, useCallback } from 'react'
import { apiFetch } from '../../lib/api'
import { AppShell, useSesion, type Rol } from '../../components/AppShell'
import { useDialog } from '../../components/Dialog'

const ETIQUETA_ROL: Record<Rol, string> = { cajero: 'Caja', admin: 'Admin', gerencia: 'Gerencia' }
interface Usuario { id: string; usuario: string; nombre: string; rol: Rol; activo: boolean }

export default function PanelPage() {
  return <AppShell active="inicio" titulo="Inicio"><PanelContenido /></AppShell>
}

function PanelContenido() {
  const me = useSesion()
  const dialog = useDialog()
  const gestor = me.usuario.rol === 'admin' || me.usuario.rol === 'gerencia'

  const [usuarios, setUsuarios] = useState<Usuario[]>([])
  const [form, setForm] = useState({ usuario: '', nombre: '', password: '', rol: 'cajero' as Rol })
  const [msg, setMsg] = useState<string | null>(null)

  const cargarUsuarios = useCallback(async () => {
    try { const r = await apiFetch<{ usuarios: Usuario[] }>('/api/usuarios'); setUsuarios(r.usuarios) } catch {}
  }, [])
  useEffect(() => { if (gestor) cargarUsuarios() }, [gestor, cargarUsuarios])

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

  return (
    <div className="card" style={{ maxWidth: 620 }}>
      <div className="row-between">
        <h3 style={{ fontFamily: 'Fraunces,serif', fontWeight: 500, fontSize: 22 }}>Hola, {me.usuario.nombre}</h3>
        <span className="badge">{ETIQUETA_ROL[me.usuario.rol]}</span>
      </div>
      <p className="hint" style={{ textAlign: 'left', marginTop: 10 }}>
        {me.ve_utilidad ? 'Acceso a utilidad y reportes financieros.' : 'Acceso de caja (sin utilidad).'}
      </p>

      {gestor && (
        <>
          <div style={{ height: 1, background: 'var(--line)', margin: '22px 0' }} />
          <h3 className="muted" style={{ fontWeight: 600, marginBottom: 12 }}>Usuarios del sistema</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 }}>
            {usuarios.map((u) => (
              <div key={u.id} className="row-between" style={{ fontSize: 13.5, gap: 8 }}>
                <span>{u.nombre} <span className="faint">· {u.usuario}</span> {!u.activo && <span className="faint">(inactivo)</span>}</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span className="faint">{ETIQUETA_ROL[u.rol]}</span>
                  <button className="link-btn" title="Restablecer contraseña" onClick={() => restablecerClave(u)}>🔑</button>
                  <button className="link-btn" title={u.activo ? 'Desactivar' : 'Activar'} onClick={() => alternarActivo(u)}>{u.activo ? '⏸' : '▶'}</button>
                  {u.id !== me.usuario.id && <button className="link-btn" title="Eliminar" onClick={() => eliminar(u)}>✕</button>}
                </span>
              </div>
            ))}
            {usuarios.length === 0 && <span className="faint">Aún no hay más usuarios.</span>}
          </div>

          <form className="form" onSubmit={crearUsuario} style={{ marginTop: 4 }}>
            <div className="field"><label>Usuario (corto)</label>
              <input value={form.usuario} placeholder="caja" autoCapitalize="none" onChange={(e) => setForm({ ...form, usuario: e.target.value })} required /></div>
            <div className="field"><label>Nombre visible (opcional)</label>
              <input value={form.nombre} placeholder="Caja" onChange={(e) => setForm({ ...form, nombre: e.target.value })} /></div>
            <div className="field"><label>Contraseña (mín. 4)</label>
              <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required /></div>
            <div className="field"><label>Rol</label>
              <select value={form.rol} onChange={(e) => setForm({ ...form, rol: e.target.value as Rol })}>
                <option value="cajero">Caja</option><option value="admin">Admin</option><option value="gerencia">Gerencia</option>
              </select></div>
            {msg && <div className="alert">{msg}</div>}
            <button className="btn" type="submit">Crear usuario</button>
          </form>
        </>
      )}
    </div>
  )
}
