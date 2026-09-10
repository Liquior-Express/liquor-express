'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { apiFetch, guardarToken } from '../../lib/api'

export default function LoginPage() {
  const router = useRouter()
  const [inicializado, setInicializado] = useState<boolean | null>(null)
  const [usuario, setUsuario] = useState('')
  const [nombre, setNombre] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)

  useEffect(() => {
    apiFetch<{ inicializado: boolean }>('/api/auth/estado')
      .then((r) => setInicializado(r.inicializado))
      .catch(() => setInicializado(true)) // ante la duda, mostrar login normal
  }, [])

  async function entrar(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setCargando(true)
    try {
      const r = await apiFetch<{ token: string }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ usuario, password }),
      })
      guardarToken(r.token)
      router.push('/panel')
    } catch (err: any) {
      setError(err.message ?? 'No se pudo ingresar')
    } finally {
      setCargando(false)
    }
  }

  async function crearAdmin(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (password !== password2) { setError('Las contraseñas no coinciden'); return }
    setCargando(true)
    try {
      const r = await apiFetch<{ token: string }>('/api/auth/bootstrap', {
        method: 'POST',
        body: JSON.stringify({ usuario, nombre, password }),
      })
      guardarToken(r.token)
      router.push('/panel')
    } catch (err: any) {
      setError(err.message ?? 'No se pudo crear el administrador')
    } finally {
      setCargando(false)
    }
  }

  if (inicializado === null) {
    return <div className="auth-wrap"><p className="muted">Cargando…</p></div>
  }

  return (
    <div className="auth-wrap">
      <div className="card">
        <div className="eyebrow">JCA Soft · Kaizen</div>
        <h1>Liquor<b>·</b>Express</h1>

        {inicializado ? (
          <>
            <p className="hint">Ingresa con tu usuario para administrar el negocio.</p>
            <form className="form" onSubmit={entrar}>
              <div className="field">
                <label htmlFor="usuario">Usuario</label>
                <input id="usuario" value={usuario} autoComplete="username" autoCapitalize="none"
                  onChange={(e) => setUsuario(e.target.value)} required />
              </div>
              <div className="field">
                <label htmlFor="password">Contraseña</label>
                <input id="password" type="password" value={password} autoComplete="current-password"
                  onChange={(e) => setPassword(e.target.value)} required />
              </div>
              {error && <div className="alert">{error}</div>}
              <button className="btn" type="submit" disabled={cargando}>{cargando ? 'Ingresando…' : 'Ingresar'}</button>
            </form>
          </>
        ) : (
          <>
            <p className="hint">Primer arranque: crea el usuario <b>administrador</b> del sistema.</p>
            <form className="form" onSubmit={crearAdmin}>
              <div className="field">
                <label htmlFor="usuario">Usuario</label>
                <input id="usuario" value={usuario} placeholder="admin" autoCapitalize="none"
                  onChange={(e) => setUsuario(e.target.value)} required />
              </div>
              <div className="field">
                <label htmlFor="nombre">Nombre visible (opcional)</label>
                <input id="nombre" value={nombre} placeholder="Liquor Express"
                  onChange={(e) => setNombre(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="password">Contraseña</label>
                <input id="password" type="password" value={password}
                  onChange={(e) => setPassword(e.target.value)} required />
              </div>
              <div className="field">
                <label htmlFor="password2">Repetir contraseña</label>
                <input id="password2" type="password" value={password2}
                  onChange={(e) => setPassword2(e.target.value)} required />
              </div>
              {error && <div className="alert">{error}</div>}
              <button className="btn" type="submit" disabled={cargando}>{cargando ? 'Creando…' : 'Crear administrador'}</button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
