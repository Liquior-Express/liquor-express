'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { apiFetch } from '../../lib/api'
import { AppShell, useSesion } from '../../components/AppShell'

interface Registro { id: string; accion: string; entidad: string | null; entidad_id: string | null; detalle: any; creado_en: string; usuario_nombre: string | null }

const hoyLocal = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' })
const haceDias = (n: number) => new Date(Date.now() - n * 864e5).toLocaleDateString('en-CA', { timeZone: 'America/Bogota' })
const fechaHora = (s: string) => new Date(s).toLocaleString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

// Nombres amigables de las acciones que registra el sistema.
const ACCIONES: Record<string, string> = {
  crear_usuario: 'Crear usuario', editar_usuario: 'Editar usuario', eliminar_usuario: 'Eliminar usuario',
  crear_producto: 'Crear producto', cambiar_precio: 'Cambiar precio', cambiar_costo: 'Cambiar costo', eliminar_producto: 'Eliminar producto',
  merma: 'Merma', importar_catalogo: 'Importar catálogo',
  abrir_caja: 'Abrir caja', cerrar_caja: 'Cerrar caja', movimiento_caja: 'Entrada/salida de caja', cambiar_tasa_real: 'Cambiar tasa del Real',
  anular_venta: 'Anular venta', registrar_compra: 'Registrar compra', pagar_compra: 'Pagar compra',
  registrar_gasto: 'Registrar gasto', reponer_caja_menor: 'Reponer caja menor', descargar_respaldo: 'Descargar respaldo',
}

// Detalle legible: "clave: valor · clave: valor" (sin llaves ni comillas).
function detalleTexto(d: any): string {
  if (!d || typeof d !== 'object') return ''
  return Object.entries(d).filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${typeof v === 'number' ? v.toLocaleString('es-CO') : typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(' · ')
}

export default function AuditoriaPage() {
  return <AppShell active="auditoria" titulo="Bitácora de auditoría"><Bitacora /></AppShell>
}

function Bitacora() {
  const me = useSesion()
  const router = useRouter()
  useEffect(() => { if (me.usuario.rol === 'cajero') router.replace('/ventas') }, [me, router])

  const [f, setF] = useState({ desde: haceDias(6), hasta: hoyLocal(), accion: '' })
  const [registros, setRegistros] = useState<Registro[]>([])
  const [msg, setMsg] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]).toString()
    setRegistros((await apiFetch<{ registros: Registro[] }>(`/api/auditoria?${q}`)).registros)
  }, [f])
  useEffect(() => { cargar().catch((e) => setMsg(e.message)) }, [cargar])

  return (
    <>
      <p className="muted" style={{ marginBottom: 12 }}>Registro de las acciones sensibles: quién hizo qué y cuándo. No se puede editar ni borrar.</p>
      <div className="toolbar" style={{ marginTop: 0 }}>
        <input type="date" className="celda" style={{ width: 150 }} value={f.desde} onChange={(e) => setF({ ...f, desde: e.target.value })} />
        <span className="faint">a</span>
        <input type="date" className="celda" style={{ width: 150 }} value={f.hasta} onChange={(e) => setF({ ...f, hasta: e.target.value })} />
        <select className="celda" style={{ width: 220 }} value={f.accion} onChange={(e) => setF({ ...f, accion: e.target.value })}>
          <option value="">Todas las acciones</option>
          {Object.entries(ACCIONES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </div>
      {msg && <div className="alert" style={{ marginBottom: 12 }}>{msg}</div>}
      <div className="tabla-wrap">
        <table className="tabla" style={{ minWidth: 720 }}>
          <thead><tr><th style={{ width: 150 }}>Fecha</th><th style={{ width: 130 }}>Usuario</th><th style={{ width: 170 }}>Acción</th><th>Detalle</th></tr></thead>
          <tbody>
            {registros.map((r) => (
              <tr key={r.id} style={{ cursor: 'default' }}>
                <td className="faint">{fechaHora(r.creado_en)}</td>
                <td>{r.usuario_nombre ?? '—'}</td>
                <td>{ACCIONES[r.accion] ?? r.accion}</td>
                <td><span className="detalle-json">{detalleTexto(r.detalle)}</span></td>
              </tr>
            ))}
            {registros.length === 0 && <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--faint)', padding: 24 }}>Sin registros en estas fechas.</td></tr>}
          </tbody>
        </table>
      </div>
      {registros.length === 500 && <p className="faint" style={{ marginTop: 8 }}>Se muestran los 500 más recientes; acorta las fechas para ver más.</p>}
    </>
  )
}
