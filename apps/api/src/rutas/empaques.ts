import type { Express } from 'express'
import { autenticar, requiereRol } from '../auth.ts'
import { hayEmpaques } from './comun.ts'

// Control por empaques (cigarrillos): productos que llegan en empaques cerrados (cajetilla x20,
// media x10) y se venden por empaque o sueltos, abriendo uno a la vez por marca. Se cuenta lo
// cerrado por presentación y los sueltos; productos.existencias sigue siendo el total en
// unidades, así reportes, alertas de stock y costos no cambian. Requiere la migración 0012.

interface Deps {
  db: () => any
  auditar: (usuarioId: string, accion: string, entidad?: string, entidadId?: string, detalle?: unknown) => Promise<void>
  registrarMovimiento: (productoId: string, tipo: 'entrada' | 'venta' | 'merma' | 'ajuste' | 'apertura', cantidad: number, usuarioId: string, referencia?: string) => Promise<void>
}

export interface EstadoEmpaques { sueltos: number; cerradas: Record<string, number> }
export interface CambioEmpaques {
  /** Empaques que se abren: cada uno pasa de cerrado a sueltos. */
  aperturas?: { presentacion_id: string; factor: number }[]
  /** Empaques cerrados que entran (+) o salen (−), por presentación. */
  cerradas?: { presentacion_id: string; cantidad: number }[]
  /** Sueltos que entran (+) o salen (−). */
  sueltos?: number
}

// Aplica un cambio sobre el estado, sin tocar la base: primero las aperturas, luego lo demás.
export function aplicarEmpaques(estado: EstadoEmpaques, cambio: CambioEmpaques): EstadoEmpaques {
  const cerradas = { ...estado.cerradas }
  let sueltos = estado.sueltos
  for (const a of cambio.aperturas ?? []) {
    cerradas[a.presentacion_id] = (cerradas[a.presentacion_id] ?? 0) - 1
    sueltos += a.factor
  }
  for (const c of cambio.cerradas ?? []) cerradas[c.presentacion_id] = (cerradas[c.presentacion_id] ?? 0) + c.cantidad
  sueltos += cambio.sueltos ?? 0
  return { sueltos, cerradas }
}

// Total en unidades de un estado: lo que debe valer productos.existencias.
export const unidadesDe = (estado: EstadoEmpaques, factores: Record<string, number>) =>
  estado.sueltos + Object.entries(estado.cerradas).reduce((s, [id, n]) => s + n * (factores[id] ?? 0), 0)

// Avisos cuando algo queda en negativo: la venta no se frena, pero hay que revisar el conteo.
export function avisosEmpaques(nombre: string, estado: EstadoEmpaques, nombresPres: Record<string, string>): string[] {
  const avisos: string[] = []
  for (const [id, n] of Object.entries(estado.cerradas)) {
    if (n < 0) avisos.push(`${nombre}: ${nombresPres[id] ?? 'empaques'} cerradas en ${n}, revisa el conteo`)
  }
  if (estado.sueltos < 0) avisos.push(`${nombre}: sueltos en ${estado.sueltos}, revisa el conteo`)
  return avisos
}

// Lee el estado actual, aplica el cambio y guarda lo que cambió. Devuelve los avisos.
export async function moverEmpaques(db: () => any, producto: { id: string; nombre: string }, cambio: CambioEmpaques): Promise<string[]> {
  const ids = [...new Set([
    ...(cambio.aperturas ?? []).map((a) => a.presentacion_id),
    ...(cambio.cerradas ?? []).map((c) => c.presentacion_id),
  ])]
  const [{ data: prod }, { data: pres }] = await Promise.all([
    db().from('productos').select('sueltos').eq('id', producto.id).single(),
    ids.length
      ? db().from('presentaciones').select('id, nombre, cerradas').eq('producto_id', producto.id).in('id', ids)
      : Promise.resolve({ data: [] as any[] }),
  ])
  const antes: EstadoEmpaques = {
    sueltos: Number(prod?.sueltos) || 0,
    cerradas: Object.fromEntries((pres ?? []).map((p: any) => [p.id, Number(p.cerradas) || 0])),
  }
  const despues = aplicarEmpaques(antes, cambio)
  for (const p of pres ?? []) {
    if (despues.cerradas[p.id] !== antes.cerradas[p.id]) await db().from('presentaciones').update({ cerradas: despues.cerradas[p.id] }).eq('id', p.id)
  }
  if (despues.sueltos !== antes.sueltos) await db().from('productos').update({ sueltos: despues.sueltos }).eq('id', producto.id)
  return avisosEmpaques(producto.nombre, despues, Object.fromEntries((pres ?? []).map((p: any) => [p.id, p.nombre])))
}

export function registrarEmpaques(app: Express, { db, auditar, registrarMovimiento }: Deps) {
  const gestor = requiereRol('admin', 'gerencia')
  const sinMigracion = (res: any) =>
    res.status(409).json({ error: 'El control por empaques necesita la actualización 0012 de la base de datos.' })
  const entero = (v: unknown) => { const n = Number(v ?? 0); return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null }

  // Conteo de empaques: activa o desactiva el control y fija las cerradas de cada presentación y
  // los sueltos. Las existencias quedan en el total contado y la diferencia va al kardex.
  app.put('/api/productos/:id/empaques', autenticar, gestor, async (req, res) => {
    if (!(await hayEmpaques(db))) return sinMigracion(res)
    const { id } = req.params
    const { data: prod } = await db().from('productos').select('id, nombre, existencias').eq('id', id).maybeSingle()
    if (!prod) return res.status(404).json({ error: 'Producto no encontrado' })

    if (req.body?.controla !== true) {
      await db().from('productos').update({ controla_empaques: false }).eq('id', id)
      await auditar(req.usuario!.id, 'empaques', 'productos', id, { controla: false })
      return res.json({ ok: true, controla: false, existencias: Number(prod.existencias) })
    }

    const { data: pres } = await db().from('presentaciones').select('id, nombre, factor_unidades').eq('producto_id', id)
    const empaques = (pres ?? []).filter((p: any) => Number(p.factor_unidades) > 1)
    if (!empaques.length) {
      return res.status(400).json({ error: 'Primero agrega las presentaciones del producto (por ejemplo, Cajetilla 20 y Media cajetilla 10).' })
    }
    const sueltos = entero(req.body?.sueltos)
    if (sueltos === null) return res.status(400).json({ error: 'Revisa la cantidad de sueltos' })
    const cerradas: Record<string, number> = {}
    for (const p of empaques) {
      const n = entero(req.body?.cerradas?.[p.id])
      if (n === null) return res.status(400).json({ error: `Revisa las ${p.nombre} cerradas` })
      cerradas[p.id] = n
    }

    const factores = Object.fromEntries(empaques.map((p: any) => [p.id, Number(p.factor_unidades)]))
    const existencias = unidadesDe({ sueltos, cerradas }, factores)
    for (const p of empaques) await db().from('presentaciones').update({ cerradas: cerradas[p.id] }).eq('id', p.id)
    const { error } = await db().from('productos').update({ controla_empaques: true, sueltos, existencias }).eq('id', id)
    if (error) return res.status(500).json({ error: error.message })

    const diferencia = existencias - Number(prod.existencias)
    if (diferencia !== 0) await registrarMovimiento(id, 'ajuste', diferencia, req.usuario!.id, 'conteo de empaques')
    await auditar(req.usuario!.id, 'empaques', 'productos', id, { controla: true, sueltos, cerradas, existencias })
    res.json({ ok: true, controla: true, sueltos, cerradas, existencias })
  })

  // Código de barras de una presentación: escanear una cajetilla agrega una cajetilla.
  app.put('/api/presentaciones/:pid/codigo', autenticar, gestor, async (req, res) => {
    if (!(await hayEmpaques(db))) return sinMigracion(res)
    const codigo = String(req.body?.codigo_barras ?? '').trim() || null
    if (codigo) {
      const { data: enProducto } = await db().from('productos').select('nombre').eq('codigo_barras', codigo).limit(1).maybeSingle()
      if (enProducto) return res.status(409).json({ error: `Ese código ya es del producto ${enProducto.nombre}` })
    }
    const { data, error } = await db().from('presentaciones').update({ codigo_barras: codigo })
      .eq('id', req.params.pid).select('id, nombre, codigo_barras').single()
    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'Ese código ya está en otra presentación' })
      return res.status(500).json({ error: error.message })
    }
    await auditar(req.usuario!.id, 'codigo_presentacion', 'presentaciones', req.params.pid, { codigo_barras: codigo })
    res.json({ presentacion: data })
  })
}
