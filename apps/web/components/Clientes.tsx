'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '../lib/api'
import { Modal } from './Modal'

// Clientes para la factura electrónica: formulario y buscador para elegir el cliente de una venta.

export interface Cliente {
  id: string; tipo_persona: 'natural' | 'juridica'; tipo_documento: string; numero_documento: string; dv: string | null
  nombre: string; email: string | null; telefono: string | null; direccion: string | null; ciudad: string | null
  departamento: string | null; responsable_iva: boolean; responsabilidad_fiscal: string; notas: string | null; activo: boolean
}

export const TIPOS_DOCUMENTO: { id: string; label: string }[] = [
  { id: 'CC', label: 'Cédula de ciudadanía' }, { id: 'NIT', label: 'NIT' }, { id: 'CE', label: 'Cédula de extranjería' },
  { id: 'PAS', label: 'Pasaporte' }, { id: 'PEP', label: 'PEP / PPT' }, { id: 'DIE', label: 'Documento extranjero' },
  { id: 'TI', label: 'Tarjeta de identidad' },
]

// Dígito de verificación del NIT (DIAN), para mostrarlo mientras se escribe.
export function digitoVerificacion(nit: string): string {
  const pesos = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71]
  const d = nit.replace(/\D/g, '').split('').reverse()
  if (!d.length || d.length > pesos.length) return ''
  const r = d.reduce((s, x, i) => s + Number(x) * pesos[i], 0) % 11
  return String(r >= 2 ? 11 - r : r)
}

export const documento = (c: Pick<Cliente, 'tipo_documento' | 'numero_documento' | 'dv'>) =>
  `${c.tipo_documento} ${c.numero_documento}${c.tipo_documento === 'NIT' && c.dv ? '-' + c.dv : ''}`

const VACIO = {
  tipo_persona: 'natural', tipo_documento: 'CC', numero_documento: '', nombre: '', email: '', telefono: '',
  direccion: '', ciudad: 'Leticia', departamento: 'Amazonas', responsable_iva: false, responsabilidad_fiscal: 'R-99-PN', notas: '',
}

export function ClienteForm({ inicial, documentoInicial, onGuardado, onCancelar }: {
  inicial?: Cliente | null; documentoInicial?: string; onGuardado: (c: Cliente) => void; onCancelar: () => void
}) {
  const [f, setF] = useState<any>(() => inicial
    ? { ...VACIO, ...Object.fromEntries(Object.entries(inicial).map(([k, v]) => [k, v ?? ''])) }
    : { ...VACIO, numero_documento: documentoInicial ?? '' })
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (k: string, v: unknown) => setF((x: any) => ({ ...x, [k]: v }))
  const esNit = f.tipo_documento === 'NIT'

  async function guardar(e: React.FormEvent) {
    e.preventDefault()
    setGuardando(true); setError(null)
    try {
      const r = await apiFetch<{ cliente: Cliente }>(inicial ? `/api/clientes/${inicial.id}` : '/api/clientes', {
        method: inicial ? 'PUT' : 'POST', body: JSON.stringify(f),
      })
      onGuardado(r.cliente)
    } catch (err: any) { setError(err.message) } finally { setGuardando(false) }
  }

  return (
    <form onSubmit={guardar} className="cliente-form">
      <div className="segmento">
        <button type="button" className={f.tipo_persona === 'natural' ? 'activo' : ''} onClick={() => set('tipo_persona', 'natural')}>Persona natural</button>
        <button type="button" className={f.tipo_persona === 'juridica' ? 'activo' : ''}
          onClick={() => setF((x: any) => ({ ...x, tipo_persona: 'juridica', tipo_documento: 'NIT' }))}>Empresa</button>
      </div>
      <div className="cliente-campos">
        <div className="field">
          <label>Tipo de documento</label>
          <select value={f.tipo_documento} onChange={(e) => set('tipo_documento', e.target.value)}>
            {TIPOS_DOCUMENTO.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Número{esNit && f.numero_documento ? ` · DV ${digitoVerificacion(f.numero_documento)}` : ''}</label>
          <input required inputMode={['CC', 'NIT', 'TI'].includes(f.tipo_documento) ? 'numeric' : 'text'} value={f.numero_documento}
            placeholder={esNit ? 'Sin dígito de verificación' : ''} onChange={(e) => set('numero_documento', e.target.value)} />
        </div>
        <div className="field ancho">
          <label>{f.tipo_persona === 'juridica' ? 'Razón social' : 'Nombres y apellidos'}</label>
          <input required value={f.nombre} onChange={(e) => set('nombre', e.target.value)} />
        </div>
        <div className="field ancho">
          <label>Correo (llega la factura electrónica)</label>
          <input type="email" value={f.email} onChange={(e) => set('email', e.target.value)} />
        </div>
        <div className="field"><label>Teléfono</label><input inputMode="tel" value={f.telefono} onChange={(e) => set('telefono', e.target.value)} /></div>
        <div className="field"><label>Dirección</label><input value={f.direccion} onChange={(e) => set('direccion', e.target.value)} /></div>
        <div className="field"><label>Ciudad</label><input value={f.ciudad} onChange={(e) => set('ciudad', e.target.value)} /></div>
        <div className="field"><label>Departamento</label><input value={f.departamento} onChange={(e) => set('departamento', e.target.value)} /></div>
        <div className="field">
          <label>Responsabilidad fiscal</label>
          <select value={f.responsabilidad_fiscal} onChange={(e) => set('responsabilidad_fiscal', e.target.value)}>
            <option value="R-99-PN">R-99-PN · No aplica / otros</option>
            <option value="O-13">O-13 · Gran contribuyente</option>
            <option value="O-15">O-15 · Autorretenedor</option>
            <option value="O-23">O-23 · Agente de retención IVA</option>
            <option value="O-47">O-47 · Régimen simple</option>
          </select>
        </div>
        <label className="check" style={{ alignSelf: 'end', paddingBottom: 10 }}>
          <input type="checkbox" checked={!!f.responsable_iva} onChange={(e) => set('responsable_iva', e.target.checked)} /> Responsable de IVA
        </label>
        <div className="field ancho"><label>Notas</label><input value={f.notas} onChange={(e) => set('notas', e.target.value)} /></div>
      </div>
      {error && <div className="alert" style={{ marginTop: 10 }}>{error}</div>}
      <div className="row-between" style={{ marginTop: 14 }}>
        <button type="button" className="btn ghost" style={{ marginTop: 0 }} onClick={onCancelar}>Cancelar</button>
        <button className="btn" style={{ marginTop: 0 }} disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar cliente'}</button>
      </div>
    </form>
  )
}

// Buscador para la venta: por nombre o documento; si no está, se crea ahí mismo.
export function ElegirCliente({ open, onClose, onElegir }: {
  open: boolean; onClose: () => void; onElegir: (c: Cliente | null) => void
}) {
  const [q, setQ] = useState('')
  const [lista, setLista] = useState<Cliente[]>([])
  const [error, setError] = useState<string | null>(null)
  const [creando, setCreando] = useState(false)

  useEffect(() => { if (open) { setQ(''); setCreando(false); setError(null) } }, [open])
  useEffect(() => {
    if (!open || creando) return
    const t = window.setTimeout(() => {
      apiFetch<{ clientes: Cliente[] }>('/api/clientes?q=' + encodeURIComponent(q.trim()))
        .then((r) => { setLista(r.clientes); setError(null) })
        .catch((e) => setError(e.message))
    }, 200)
    return () => window.clearTimeout(t)
  }, [q, open, creando])

  const soloNumeros = /^\d{5,}$/.test(q.trim())
  return (
    <Modal open={open} title={creando ? 'Nuevo cliente' : 'Cliente de la venta'} onClose={onClose} ancho={creando ? 600 : 460}>
      {creando ? (
        <ClienteForm documentoInicial={soloNumeros ? q.trim() : ''} onCancelar={() => setCreando(false)} onGuardado={(c) => onElegir(c)} />
      ) : (
        <div>
          <input className="celda" autoFocus placeholder="Buscar por nombre, cédula o NIT" value={q} onChange={(e) => setQ(e.target.value)} />
          {error && <div className="alert" style={{ marginTop: 10 }}>{error}</div>}
          <div className="cliente-lista">
            <button type="button" className="cliente-item" onClick={() => onElegir(null)}>
              <b>Consumidor final</b><span className="faint">Sin datos de cliente</span>
            </button>
            {lista.map((c) => (
              <button key={c.id} type="button" className="cliente-item" onClick={() => onElegir(c)}>
                <b>{c.nombre}</b><span className="faint">{documento(c)}{c.email ? ' · ' + c.email : ''}</span>
              </button>
            ))}
            {!error && q.trim() && lista.length === 0 && <p className="faint" style={{ padding: 8 }}>No hay clientes con «{q.trim()}».</p>}
          </div>
          {!error && <button type="button" className="btn" style={{ width: '100%' }} onClick={() => setCreando(true)}>＋ Nuevo cliente</button>}
        </div>
      )}
    </Modal>
  )
}
