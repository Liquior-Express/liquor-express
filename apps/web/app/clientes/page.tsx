'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../../lib/api'
import { AppShell } from '../../components/AppShell'
import { Modal } from '../../components/Modal'
import { ClienteForm, documento, type Cliente } from '../../components/Clientes'

export default function ClientesPage() {
  return <AppShell active="clientes" titulo="Clientes"><Clientes /></AppShell>
}

function Clientes() {
  const [q, setQ] = useState('')
  const [verInactivos, setVerInactivos] = useState(false)
  const [lista, setLista] = useState<Cliente[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editando, setEditando] = useState<Cliente | 'nuevo' | null>(null)

  const cargar = useCallback(async () => {
    const params = new URLSearchParams()
    if (q.trim()) params.set('q', q.trim())
    if (verInactivos) params.set('todos', '1')
    try {
      const r = await apiFetch<{ clientes: Cliente[] }>('/api/clientes?' + params.toString())
      setLista(r.clientes); setError(null)
    } catch (e: any) { setError(e.message); setLista([]) }
  }, [q, verInactivos])
  useEffect(() => { const t = window.setTimeout(cargar, 200); return () => window.clearTimeout(t) }, [cargar])

  async function cambiarActivo(c: Cliente) {
    try {
      await apiFetch(`/api/clientes/${c.id}`, { method: 'PUT', body: JSON.stringify({ ...c, activo: !c.activo }) })
      setEditando(null); cargar()
    } catch (e: any) { setError(e.message) }
  }

  return (
    <>
      <p className="muted" style={{ marginTop: 0 }}>
        Datos para la factura electrónica. En Ventas rápidas se elige el cliente antes de cobrar; si no se elige, la venta queda a consumidor final.
      </p>
      <div className="toolbar">
        <input className="buscar" placeholder="Buscar por nombre, cédula o NIT" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="check"><input type="checkbox" checked={verInactivos} onChange={(e) => setVerInactivos(e.target.checked)} /> Ver inactivos</label>
        <button className="btn" style={{ marginTop: 0 }} onClick={() => setEditando('nuevo')}>＋ Nuevo cliente</button>
      </div>
      {error && <div className="alert" style={{ marginBottom: 12 }}>{error}</div>}

      <div className="tabla-wrap">
        <table className="tabla">
          <thead><tr><th>Cliente</th><th>Documento</th><th>Correo</th><th>Teléfono</th><th>Ciudad</th></tr></thead>
          <tbody>
            {(lista ?? []).map((c) => (
              <tr key={c.id} className={c.activo ? '' : 'inactivo'} onClick={() => setEditando(c)}>
                <td><b>{c.nombre}</b>{c.tipo_persona === 'juridica' && <span className="faint"> · empresa</span>}</td>
                <td>{documento(c)}</td>
                <td>{c.email ?? '—'}</td>
                <td>{c.telefono ?? '—'}</td>
                <td>{c.ciudad ?? '—'}</td>
              </tr>
            ))}
            {lista && lista.length === 0 && !error && (
              <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--faint)', padding: 24 }}>{q.trim() ? 'Sin resultados.' : 'Aún no hay clientes.'}</td></tr>
            )}
            {!lista && <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--faint)', padding: 24 }}>Cargando…</td></tr>}
          </tbody>
        </table>
      </div>

      <Modal open={!!editando} title={editando === 'nuevo' ? 'Nuevo cliente' : 'Editar cliente'} onClose={() => setEditando(null)} ancho={600}>
        {editando && (
          <>
            <ClienteForm key={editando === 'nuevo' ? 'nuevo' : editando.id} inicial={editando === 'nuevo' ? null : editando}
              onCancelar={() => setEditando(null)} onGuardado={() => { setEditando(null); cargar() }} />
            {editando !== 'nuevo' && (
              <button type="button" className="link-btn" style={{ marginTop: 12 }} onClick={() => cambiarActivo(editando)}>
                {editando.activo ? 'Desactivar cliente (ya no aparece al vender)' : 'Volver a activar'}
              </button>
            )}
          </>
        )}
      </Modal>
    </>
  )
}
