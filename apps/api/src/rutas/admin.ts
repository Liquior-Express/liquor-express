import type { Express } from 'express'
import { autenticar, requiereRol } from '../auth.ts'
import { hoy, inicioDia, finDia } from './comun.ts'

// Administración: importar el catálogo desde Excel, bitácora de auditoría y respaldo de datos.

interface Deps {
  db: () => any
  auditar: (usuarioId: string, accion: string, entidad?: string, entidadId?: string, detalle?: unknown) => Promise<void>
}

const fechaValida = (s: unknown) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)

// Números como vienen del Excel: 52000 · "52.000" · "$ 52.000" · "2,5" → 52000 / 2.5
function num(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') return undefined
  if (typeof v === 'number') return isFinite(v) ? v : undefined
  const s = String(v).replace(/[$\s]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')
  const n = Number(s)
  return s !== '' && isFinite(n) ? n : undefined
}
const siNo = (v: unknown) => ['si', 'sí', 'x', '1', 'true', 'verdadero', 'yes', 's'].includes(String(v ?? '').trim().toLowerCase())
const vacio = (v: unknown) => v === undefined || v === null || String(v).trim() === ''

export function registrarAdmin(app: Express, { db, auditar }: Deps) {
  const gestor = requiereRol('admin', 'gerencia')
  const soloAdmin = requiereRol('admin')

  // Lee una tabla completa (Supabase devuelve máximo 1.000 filas por consulta).
  async function todas(tabla: string, cols = '*') {
    const orden = tabla === 'tasa_real' ? 'fecha' : 'id'
    const filas: any[] = []
    for (let desde = 0; ; desde += 1000) {
      const { data, error } = await db().from(tabla).select(cols).order(orden).range(desde, desde + 999)
      if (error) throw new Error(`${tabla}: ${error.message}`)
      filas.push(...(data ?? []))
      if (!data || data.length < 1000) break
    }
    return filas
  }

  // ── Importar catálogo (el navegador ya leyó el Excel): crea o actualiza por nombre ──
  app.post('/api/productos/importar', autenticar, gestor, async (req, res) => {
    const filas: any[] = Array.isArray(req.body?.filas) ? req.body.filas : []
    if (filas.length === 0) return res.status(400).json({ error: 'El archivo no tiene productos' })
    if (filas.length > 3000) return res.status(400).json({ error: 'Máximo 3.000 productos por archivo' })

    try {
      // 1) Categorías: crear de una vez las que no existen.
      const cats = await todas('categorias', 'id, nombre')
      const catId = new Map<string, string>(cats.map((c: any) => [c.nombre.trim().toLowerCase(), c.id]))
      // Solo de las filas válidas: una fila sin nombre no debe crear su categoría.
      const nuevasCats = [...new Set(filas
        .filter((f) => String(f.nombre ?? '').trim())
        .map((f) => String(f.categoria ?? '').trim())
        .filter((c) => c && !catId.has(c.toLowerCase())))]
      if (nuevasCats.length) {
        const { data, error } = await db().from('categorias').insert(nuevasCats.map((nombre) => ({ nombre }))).select('id, nombre')
        if (error) return res.status(500).json({ error: error.message })
        for (const c of data ?? []) catId.set(c.nombre.trim().toLowerCase(), c.id)
      }

      // 2) Preparar filas: nuevas vs. existentes (mismo nombre, sin importar mayúsculas).
      const prods = await todas('productos', 'id, nombre, existencias')
      const porNombre = new Map<string, any>(prods.map((p: any) => [p.nombre.trim().toLowerCase(), p]))
      const errores: string[] = []
      const nuevos: any[] = []
      const actualizar: { fila: number; producto: any; campos: any; existencias?: number }[] = []
      const vistos = new Set<string>()

      filas.forEach((f, i) => {
        const fila = i + 2 // fila 1 = títulos
        const nombre = String(f.nombre ?? '').trim()
        if (!nombre) return errores.push(`Fila ${fila}: falta el nombre`)
        const clave = nombre.toLowerCase()
        if (vistos.has(clave)) return errores.push(`Fila ${fila} (${nombre}): nombre repetido en el archivo`)
        vistos.add(clave)

        const campos: any = {}
        const cat = String(f.categoria ?? '').trim()
        if (cat) campos.categoria_id = catId.get(cat.toLowerCase())
        const costo = num(f.costo), cv = num(f.costos_variables), precio = num(f.precio_venta)
        const margen = num(f.margen_pct), smin = num(f.stock_min), existencias = num(f.existencias)
        if (costo !== undefined) campos.costo = costo
        if (cv !== undefined) campos.costos_variables = cv
        if (smin !== undefined) campos.stock_min = smin
        if (!vacio(f.es_pola)) campos.es_pola = siNo(f.es_pola)
        if (!vacio(f.controla_vencimiento)) campos.controla_vencimiento = siNo(f.controla_vencimiento)
        if (!vacio(f.codigo_barras)) campos.codigo_barras = String(f.codigo_barras).trim()
        // Precio y margen: si falta uno, se calcula con el otro y el costo.
        const base = (costo ?? 0) + (cv ?? 0)
        if (precio !== undefined) campos.precio_venta = precio
        if (margen !== undefined) campos.margen_pct = margen
        if (precio === undefined && margen !== undefined && base > 0) campos.precio_venta = Math.round(base * (1 + margen / 100))
        if (margen === undefined && precio !== undefined && base > 0) campos.margen_pct = Math.round((precio / base - 1) * 100)

        const existente = porNombre.get(clave)
        if (existente) actualizar.push({ fila, producto: existente, campos, existencias })
        else nuevos.push({ fila, datos: { nombre, ...campos, existencias: existencias ?? 0 } })
      })

      // 3) Crear los nuevos por bloques; si un bloque falla (p. ej. código repetido), fila por fila.
      const creadosRows: any[] = []
      const insertarUno = async (n: any) => {
        const { data, error } = await db().from('productos').insert(n.datos).select('id, existencias').single()
        if (error) errores.push(`Fila ${n.fila} (${n.datos.nombre}): ${error.code === '23505' ? 'código de barras repetido' : error.message}`)
        else creadosRows.push(data)
      }
      for (let i = 0; i < nuevos.length; i += 200) {
        const bloque = nuevos.slice(i, i + 200)
        const { data, error } = await db().from('productos').insert(bloque.map((n) => n.datos)).select('id, existencias')
        if (!error) creadosRows.push(...(data ?? []))
        else for (const n of bloque) await insertarUno(n)
      }
      const entradas = creadosRows.filter((p) => Number(p.existencias) > 0)
        .map((p) => ({ producto_id: p.id, tipo: 'entrada', cantidad: Number(p.existencias), referencia: 'importación', usuario_id: req.usuario!.id }))
      for (let i = 0; i < entradas.length; i += 500) await db().from('movimientos_inventario').insert(entradas.slice(i, i + 500))

      // 4) Actualizar los que ya existían (y dejar el ajuste de existencias en el kardex).
      let actualizados = 0
      const ajustes: any[] = []
      for (const a of actualizar) {
        const campos = { ...a.campos }
        if (a.existencias !== undefined) campos.existencias = a.existencias
        if (Object.keys(campos).length === 0) { actualizados++; continue }
        const { error } = await db().from('productos').update(campos).eq('id', a.producto.id)
        if (error) { errores.push(`Fila ${a.fila} (${a.producto.nombre}): ${error.code === '23505' ? 'código de barras repetido' : error.message}`); continue }
        actualizados++
        const delta = a.existencias !== undefined ? a.existencias - Number(a.producto.existencias) : 0
        if (delta) ajustes.push({ producto_id: a.producto.id, tipo: 'ajuste', cantidad: delta, referencia: 'importación', usuario_id: req.usuario!.id })
      }
      for (let i = 0; i < ajustes.length; i += 500) await db().from('movimientos_inventario').insert(ajustes.slice(i, i + 500))

      await auditar(req.usuario!.id, 'importar_catalogo', 'productos', undefined, { creados: creadosRows.length, actualizados, errores: errores.length })
      res.json({ creados: creadosRows.length, actualizados, categorias_nuevas: nuevasCats.length, errores })
    } catch (e: any) {
      res.status(500).json({ error: e.message ?? 'Error al importar' })
    }
  })

  // ── Bitácora de auditoría ──
  app.get('/api/auditoria', autenticar, gestor, async (req, res) => {
    const hasta = fechaValida(req.query.hasta) ? String(req.query.hasta) : hoy()
    const desde = fechaValida(req.query.desde) ? String(req.query.desde)
      : new Date(Date.now() - 6 * 864e5).toLocaleDateString('en-CA', { timeZone: 'America/Bogota' })
    let q = db().from('auditoria').select('id, accion, entidad, entidad_id, detalle, creado_en, usuario:usuarios(nombre)')
      .gte('creado_en', inicioDia(desde)).lte('creado_en', finDia(hasta)).order('creado_en', { ascending: false }).limit(500)
    if (typeof req.query.accion === 'string' && req.query.accion) q = q.eq('accion', req.query.accion)
    const { data, error } = await q
    if (error) return res.status(500).json({ error: error.message })
    res.json({ desde, hasta, registros: (data ?? []).map(({ usuario, ...r }: any) => ({ ...r, usuario_nombre: usuario?.nombre ?? null })) })
  })

  // ── Respaldo completo de los datos (JSON, solo Admin; sin contraseñas) ──
  app.get('/api/respaldo', autenticar, soloAdmin, async (req, res) => {
    const tablas = [
      'categorias', 'productos', 'presentaciones', 'lotes', 'costos_origen', 'proveedores', 'compras', 'compra_items',
      'ventas', 'venta_items', 'sesiones_caja', 'movimientos_caja', 'gastos', 'caja_menor', 'movimientos_caja_menor',
      'movimientos_inventario', 'mermas', 'tasa_real', 'facturas_dian', 'auditoria',
    ]
    try {
      const datos: Record<string, any[]> = {}
      for (const t of tablas) datos[t] = await todas(t)
      datos.usuarios = await todas('usuarios', 'id, usuario, nombre, rol, activo, creado_en')
      await auditar(req.usuario!.id, 'descargar_respaldo', 'respaldo', hoy(), { tablas: tablas.length + 1 })
      res.setHeader('Content-Disposition', `attachment; filename="respaldo-liquor-express-${hoy()}.json"`)
      res.json({ sistema: 'Liquor Express', generado: new Date().toISOString(), version: 1, datos })
    } catch (e: any) {
      res.status(500).json({ error: e.message ?? 'No se pudo generar el respaldo' })
    }
  })
}
