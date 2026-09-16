import type { Express } from 'express'
import { autenticar } from '../auth.ts'
import { hayClientes, SIN_0014 } from './comun.ts'

// Clientes para la factura electrónica: documento, nombre o razón social, correo y datos de contacto.
// Cualquier usuario puede buscarlos y crearlos desde la venta.

interface Deps {
  db: () => any
  auditar: (usuarioId: string, accion: string, entidad?: string, entidadId?: string, detalle?: unknown) => Promise<void>
}

const TIPOS_DOC = ['CC', 'NIT', 'CE', 'PAS', 'TI', 'PEP', 'DIE']
const COLS = 'id, tipo_persona, tipo_documento, numero_documento, dv, nombre, email, telefono, direccion, ciudad, departamento, responsable_iva, responsabilidad_fiscal, notas, activo'

// Dígito de verificación del NIT (DIAN).
export function digitoVerificacion(nit: string): string {
  const pesos = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71]
  const d = nit.replace(/\D/g, '').split('').reverse()
  if (!d.length || d.length > pesos.length) return ''
  const r = d.reduce((s, x, i) => s + Number(x) * pesos[i], 0) % 11
  return String(r >= 2 ? 11 - r : r)
}

const texto = (v: unknown, max = 200) => {
  const s = String(v ?? '').trim().slice(0, max)
  return s || null
}

// Datos que llegan del formulario, limpios. Devuelve el error si falta algo.
function leerCliente(b: any): { datos?: any; error?: string } {
  const tipo_documento = TIPOS_DOC.includes(b?.tipo_documento) ? b.tipo_documento : 'CC'
  const numero_documento = String(b?.numero_documento ?? '').replace(/[\s.]/g, '').slice(0, 20)
  const nombre = texto(b?.nombre)
  if (!numero_documento) return { error: 'Escribe el número de documento' }
  if (!nombre) return { error: 'Escribe el nombre o la razón social' }
  const email = texto(b?.email, 120)
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'El correo no es válido' }
  const numero = tipo_documento === 'NIT' ? numero_documento.split('-')[0] : numero_documento
  return {
    datos: {
      tipo_persona: b?.tipo_persona === 'juridica' ? 'juridica' : 'natural',
      tipo_documento, numero_documento: numero,
      dv: tipo_documento === 'NIT' ? digitoVerificacion(numero) : null,
      nombre, email, telefono: texto(b?.telefono, 40), direccion: texto(b?.direccion), ciudad: texto(b?.ciudad, 80),
      departamento: texto(b?.departamento, 80), responsable_iva: !!b?.responsable_iva,
      responsabilidad_fiscal: texto(b?.responsabilidad_fiscal, 40) ?? 'R-99-PN', notas: texto(b?.notas, 500),
    },
  }
}

export function registrarClientes(app: Express, { db, auditar }: Deps) {
  const errorDe = (res: any, error: any) => {
    if (error?.code === '23505') return res.status(409).json({ error: 'Ya hay un cliente con ese documento' })
    return res.status(500).json({ error: error.message })
  }

  app.get('/api/clientes', autenticar, async (req, res) => {
    if (!(await hayClientes(db))) return res.status(409).json({ error: SIN_0014, sin_actualizacion: true })
    const q = String(req.query.q ?? '').trim().replace(/[%,()]/g, ' ').slice(0, 60)
    let consulta = db().from('clientes').select(COLS).order('nombre').limit(req.query.q ? 30 : 500)
    if (req.query.todos !== '1') consulta = consulta.eq('activo', true)
    if (q) consulta = consulta.or(`nombre.ilike.%${q}%,numero_documento.ilike.%${q.replace(/\D/g, '') || q}%`)
    const { data, error } = await consulta
    if (error) return res.status(500).json({ error: error.message })
    res.json({ clientes: data })
  })

  app.post('/api/clientes', autenticar, async (req, res) => {
    if (!(await hayClientes(db))) return res.status(409).json({ error: SIN_0014 })
    const { datos, error: e } = leerCliente(req.body)
    if (e) return res.status(400).json({ error: e })
    const { data, error } = await db().from('clientes').insert(datos).select(COLS).single()
    if (error) return errorDe(res, error)
    await auditar(req.usuario!.id, 'crear_cliente', 'clientes', data.id, { nombre: data.nombre, documento: data.numero_documento })
    res.status(201).json({ cliente: data })
  })

  app.put('/api/clientes/:id', autenticar, async (req, res) => {
    if (!(await hayClientes(db))) return res.status(409).json({ error: SIN_0014 })
    const { datos, error: e } = leerCliente(req.body)
    if (e) return res.status(400).json({ error: e })
    const activo = req.body?.activo === undefined ? {} : { activo: !!req.body.activo }
    const { data, error } = await db().from('clientes')
      .update({ ...datos, ...activo, actualizado_en: new Date().toISOString() }).eq('id', req.params.id).select(COLS).maybeSingle()
    if (error) return errorDe(res, error)
    if (!data) return res.status(404).json({ error: 'Cliente no encontrado' })
    await auditar(req.usuario!.id, 'editar_cliente', 'clientes', data.id, { nombre: data.nombre, activo: data.activo })
    res.json({ cliente: data })
  })
}
