'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { apiFetch, leerToken, borrarToken } from '../lib/api'

export type Rol = 'cajero' | 'admin' | 'gerencia'
export interface Me {
  usuario: { id: string; usuario: string; nombre: string; rol: Rol; activo: boolean }
  ve_utilidad: boolean
}

const SesionCtx = createContext<Me | null>(null)
export const useSesion = (): Me => {
  const c = useContext(SesionCtx)
  if (!c) throw new Error('useSesion fuera de <AppShell>')
  return c
}

const ETIQUETA: Record<Rol, string> = { cajero: 'Caja', admin: 'Admin', gerencia: 'Gerencia' }

interface ItemNav { key: string; label: string; href?: string; icono: string; roles?: Rol[]; pronto?: boolean }
const NAV: ItemNav[] = [
  { key: 'inicio', label: 'Inicio', href: '/panel', icono: '🏠' },
  { key: 'ventas', label: 'Ventas rápidas', href: '/ventas', icono: '⚡' },
  { key: 'inventario', label: 'Inventario', href: '/inventario', icono: '📦', roles: ['admin', 'gerencia'] },
  { key: 'compras', label: 'Compras', icono: '📥', roles: ['admin', 'gerencia'], pronto: true },
  { key: 'caja', label: 'Caja', icono: '💵', pronto: true },
  { key: 'reportes', label: 'Reportes', icono: '📊', roles: ['admin', 'gerencia'], pronto: true },
]

export function AppShell({ active, titulo, children }: { active: string; titulo: string; children: React.ReactNode }) {
  const router = useRouter()
  const [me, setMe] = useState<Me | null>(null)
  const [tema, setTema] = useState<'dark' | 'light'>('dark')
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let t: 'dark' | 'light' = 'dark'
    try { t = (localStorage.getItem('le_tema') as any) || 'dark' } catch {}
    setTema(t); document.documentElement.dataset.theme = t
  }, [])

  useEffect(() => {
    if (!leerToken()) { router.replace('/login'); return }
    apiFetch<Me>('/api/auth/me')
      .then(setMe)
      .catch((e) => {
        // Sesión que ya no sirve (usuario eliminado, token vencido o alterado) → volver al login.
        if (e?.status === 401 || String(e.message).match(/token|inválida|expirada|autenticado/i)) { borrarToken(); router.replace('/login') }
        else setError(e.message)
      })
      .finally(() => setCargando(false))
  }, [router])

  // Latido de presencia: mantiene al usuario "en línea" mientras tenga la app abierta.
  useEffect(() => {
    if (!me) return
    const t = setInterval(() => {
      apiFetch('/api/auth/me').catch((e) => { if (e?.status === 401) { borrarToken(); router.replace('/login') } })
    }, 60_000)
    return () => clearInterval(t)
  }, [me, router])

  function toggleTema() {
    const n = tema === 'dark' ? 'light' : 'dark'
    setTema(n); document.documentElement.dataset.theme = n
    try { localStorage.setItem('le_tema', n) } catch {}
  }
  async function salir() {
    try { await apiFetch('/api/auth/salir', { method: 'POST' }) } catch {}
    borrarToken(); router.replace('/login')
  }

  if (cargando) return <div className="auth-wrap"><p className="muted">Cargando…</p></div>
  if (error) return (
    <div className="auth-wrap"><div className="card">
      <div className="alert">{error}</div>
      <button className="btn" style={{ marginTop: 16, width: '100%' }} onClick={() => window.location.reload()}>Reintentar</button>
      <button className="btn ghost" style={{ marginTop: 10, width: '100%' }} onClick={salir}>Volver a ingresar</button>
    </div></div>
  )
  if (!me) return null

  const items = NAV.filter((i) => !i.roles || i.roles.includes(me.usuario.rol))

  return (
    <SesionCtx.Provider value={me}>
      <div className="shell">
        <aside className="sidebar">
          <div className="marca">Liquor<b>·</b>Express</div>
          <nav className="menu">
            {items.map((i) => i.pronto ? (
              <div key={i.key} className="item pronto"><span className="ico">{i.icono}</span><span>{i.label}</span><span className="tag">pronto</span></div>
            ) : (
              <a key={i.key} href={i.href} className={'item' + (active === i.key ? ' activo' : '')}>
                <span className="ico">{i.icono}</span><span>{i.label}</span>
              </a>
            ))}
          </nav>
          <div className="pie">JCA Soft · Kaizen</div>
        </aside>

        <div className="contenido">
          <header className="appbar">
            <div className="titulo">{titulo}</div>
            <div className="der">
              <button className="tema-btn" onClick={toggleTema} title="Modo día / noche" aria-label="Cambiar tema">
                {tema === 'dark' ? '☀️' : '🌙'}
              </button>
              <span className="usuario-chip"><span>{me.usuario.nombre}</span> <span className="badge">{ETIQUETA[me.usuario.rol]}</span></span>
              <button className="tema-btn" onClick={salir} title="Cerrar sesión" aria-label="Cerrar sesión">⎋</button>
            </div>
          </header>
          <main className="area">{children}</main>
        </div>
      </div>
    </SesionCtx.Provider>
  )
}
