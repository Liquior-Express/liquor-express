'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { apiFetch, leerToken, borrarToken } from '../lib/api'
import { leerCola, sincronizarCola } from '../lib/cola'

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
const ME_KEY = 'le_me' // última sesión conocida (para seguir vendiendo sin conexión)
const GESTION: Rol[] = ['admin', 'gerencia']

interface ItemNav { key: string; label: string; href?: string; icono: string; roles?: Rol[]; pronto?: boolean }
const NAV: ItemNav[] = [
  { key: 'inicio', label: 'Inicio', href: '/panel', icono: '🏠' },
  { key: 'ventas', label: 'Ventas rápidas', href: '/ventas', icono: '⚡' },
  { key: 'historial', label: 'Historial de ventas', href: '/historial', icono: '🧾' },
  { key: 'caja', label: 'Caja', href: '/caja', icono: '💵' },
  { key: 'inventario', label: 'Inventario', href: '/inventario', icono: '📦', roles: GESTION },
  { key: 'compras', label: 'Compras', href: '/compras', icono: '📥', roles: GESTION },
  { key: 'gastos', label: 'Gastos y caja menor', href: '/gastos', icono: '💸', roles: GESTION },
  { key: 'flujo', label: 'Flujo de caja', href: '/flujo', icono: '📈', roles: GESTION },
  { key: 'reportes', label: 'Reportes', href: '/reportes', icono: '📊', roles: GESTION },
  { key: 'auditoria', label: 'Bitácora', href: '/auditoria', icono: '🛡️', roles: GESTION },
]

export function AppShell({ active, titulo, children }: { active: string; titulo: string; children: React.ReactNode }) {
  const router = useRouter()
  const [me, setMe] = useState<Me | null>(null)
  const [tema, setTema] = useState<'dark' | 'light'>('dark')
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [enLinea, setEnLinea] = useState(true)
  const [pendientes, setPendientes] = useState(0)
  const [menuAbierto, setMenuAbierto] = useState(false)

  useEffect(() => {
    let t: 'dark' | 'light' = 'dark'
    try { t = (localStorage.getItem('le_tema') as any) || 'dark' } catch {}
    setTema(t); document.documentElement.dataset.theme = t
  }, [])

  // Menú plegable (celular/tablet): cerrar con Escape y no dejar que el fondo se desplace.
  useEffect(() => {
    if (!menuAbierto) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuAbierto(false) }
    window.addEventListener('keydown', h)
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', h); document.body.style.overflow = '' }
  }, [menuAbierto])

  // Service worker (solo en producción): permite abrir la app sin conexión.
  useEffect(() => {
    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {})
  }, [])

  useEffect(() => {
    if (!leerToken()) { router.replace('/login'); return }
    apiFetch<Me>('/api/auth/me')
      .then((m) => { setMe(m); try { localStorage.setItem(ME_KEY, JSON.stringify(m)) } catch {} })
      .catch((e) => {
        // Sesión que ya no sirve (usuario eliminado, token vencido o alterado) → volver al login.
        if (e?.status === 401 || String(e.message).match(/token|inválida|expirada|autenticado/i)) { borrarToken(); router.replace('/login'); return }
        // Sin conexión: seguir con la última sesión conocida para poder vender.
        if (e?.status === 0 || e?.status === 503) {
          try { const g = localStorage.getItem(ME_KEY); if (g) { setMe(JSON.parse(g)); setEnLinea(false); return } } catch {}
        }
        setError(e.message)
      })
      .finally(() => setCargando(false))
  }, [router])

  // Latido de presencia: mantiene al usuario "en línea" y detecta si volvió la conexión.
  useEffect(() => {
    if (!me) return
    const t = setInterval(() => {
      apiFetch('/api/auth/me')
        .then(() => setEnLinea(true))
        .catch((e) => {
          if (e?.status === 401) { borrarToken(); router.replace('/login') }
          else if (e?.status === 0) setEnLinea(false)
        })
    }, 60_000)
    return () => clearInterval(t)
  }, [me, router])

  // Ventas guardadas sin conexión: se envían solas al volver la señal.
  useEffect(() => {
    if (!me) return
    const actualizar = () => setPendientes(leerCola().length)
    const intentar = () => { if (leerCola().length) sincronizarCola().then(actualizar).catch(() => {}) }
    const alVolver = () => { setEnLinea(true); intentar() }
    const alCaer = () => setEnLinea(false)
    actualizar(); intentar()
    window.addEventListener('le-cola', actualizar)
    window.addEventListener('online', alVolver)
    window.addEventListener('offline', alCaer)
    const t = setInterval(intentar, 30_000)
    return () => {
      window.removeEventListener('le-cola', actualizar)
      window.removeEventListener('online', alVolver)
      window.removeEventListener('offline', alCaer)
      clearInterval(t)
    }
  }, [me])

  function toggleTema() {
    const n = tema === 'dark' ? 'light' : 'dark'
    setTema(n); document.documentElement.dataset.theme = n
    try { localStorage.setItem('le_tema', n) } catch {}
  }
  async function salir() {
    try { await apiFetch('/api/auth/salir', { method: 'POST' }) } catch {}
    try { localStorage.removeItem(ME_KEY) } catch {}
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
        {menuAbierto && <div className="velo" onClick={() => setMenuAbierto(false)} />}

        <aside className={'sidebar' + (menuAbierto ? ' abierto' : '')}>
          <button className="cerrar-menu" aria-label="Cerrar menú" onClick={() => setMenuAbierto(false)}>✕</button>
          <div className="marca">Liquor<b>·</b>Express</div>
          <nav className="menu">
            {items.map((i) => i.pronto ? (
              <div key={i.key} className="item pronto"><span className="ico">{i.icono}</span><span>{i.label}</span><span className="tag">pronto</span></div>
            ) : (
              <a key={i.key} href={i.href} className={'item' + (active === i.key ? ' activo' : '')} onClick={() => setMenuAbierto(false)}>
                <span className="ico">{i.icono}</span><span>{i.label}</span>
              </a>
            ))}
          </nav>
          <div className="pie">JCA Soft · Kaizen</div>
        </aside>

        <div className="contenido">
          <header className="appbar">
            <button className="menu-btn" aria-label="Abrir menú" onClick={() => setMenuAbierto(true)}>☰</button>
            <div className="titulo">{titulo}</div>
            <div className="der">
              {!enLinea && <span className="chip-app alerta" title="Las ventas se guardan en el equipo y se envían al volver la señal">Sin conexión</span>}
              {pendientes > 0 && (
                <button className="chip-app" title="Ventas guardadas sin conexión — toca para enviarlas ahora"
                  onClick={() => sincronizarCola().then(() => setPendientes(leerCola().length))}>⏳ {pendientes}</button>
              )}
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
