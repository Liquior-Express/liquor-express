import type { Express } from 'express'
import { autenticar, requiereRol, veUtilidad, olvidarActividad } from '../auth.ts'

// Rutas de las mejoras del Sprint 1: presencia, borrar producto, existencias
// por presentación, costos por origen (Colombia/Brasil), tasa del Real y ventas rápidas.

interface Deps {
  db: () => any
  auditar: (usuarioId: string, accion: string, entidad?: string, entidadId?: string, detalle?: unknown) => Promise<void>
  registrarMovimiento: (productoId: string, tipo: 'entrada' | 'venta' | 'merma' | 'ajuste', cantidad: number, usuarioId: string, referencia?: string) => Promise<void>
}

// Fecha de hoy en Colombia (AAAA-MM-DD).
const hoy = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' })
const redondear2 = (n: number) => Math.round(n * 100) / 100
const MEDIOS = ['efectivo', 'nequi', 'bold', 'pix']

export function registrarExtras(app: Express, { db, auditar, registrarMovimiento }: Deps) {
  const gestor = requiereRol('admin', 'gerencia')

  // ── Presencia: al cerrar sesión el usuario queda desconectado ──
  app.post('/api/auth/salir', autenticar, async (req, res) => {
    olvidarActividad(req.usuario!.id)
    await db().from('usuarios').update({ ultima_actividad: null }).eq('id', req.usuario!.id)
    res.json({ ok: true })
  })

  // ── Presentaciones de todos los productos (existencias discriminadas) ──
  app.get('/api/presentaciones', autenticar, async (_req, res) => {
    const { data, error } = await db().from('presentaciones').select('id, producto_id, nombre, factor_unidades, precio')
    if (error) return res.status(500).json({ error: error.message })
    res.json({ presentaciones: data })
  })

  // ── Borrar producto (solo si no tiene ventas ni compras; si las tiene, se desactiva) ──
  app.delete('/api/productos/:id', autenticar, gestor, async (req, res) => {
    const { id } = req.params
    const [v, c] = await Promise.all([
      db().from('venta_items').select('id', { count: 'exact', head: true }).eq('producto_id', id),
      db().from('compra_items').select('id', { count: 'exact', head: true }).eq('producto_id', id),
    ])
    if ((v.count ?? 0) + (c.count ?? 0) > 0) {
      return res.status(409).json({ error: 'Este producto ya tiene ventas o compras registradas. Desactívalo en lugar de borrarlo.' })
    }
    const { data: prod } = await db().from('productos').select('nombre').eq('id', id).maybeSingle()
    if (!prod) return res.status(404).json({ error: 'Producto no encontrado' })

    // movimientos y mermas no tienen borrado en cascada; presentaciones, lotes y costos sí.
    await db().from('movimientos_inventario').delete().eq('producto_id', id)
    await db().from('mermas').delete().eq('producto_id', id)
    const { error } = await db().from('productos').delete().eq('id', id)
    if (error) return res.status(500).json({ error: error.message })
    await db().storage.from('productos').remove([`${id}.jpg`, `${id}.png`, `${id}.webp`])
    await auditar(req.usuario!.id, 'eliminar_producto', 'productos', id, { nombre: prod.nombre })
    res.json({ ok: true })
  })

  // ── Tasa del Real (pesos por 1 R$), una por día ──
  app.get('/api/tasa', autenticar, async (_req, res) => {
    const { data } = await db().from('tasa_real').select('fecha, valor').order('fecha', { ascending: false }).limit(1).maybeSingle()
    res.json({ hoy: hoy(), tasa: data ?? null, es_de_hoy: data?.fecha === hoy() })
  })

  app.put('/api/tasa', autenticar, gestor, async (req, res) => {
    const valor = Number(req.body?.valor)
    if (!(valor > 0)) return res.status(400).json({ error: 'Escribe una tasa válida (pesos por 1 Real)' })
    const { error } = await db().from('tasa_real').upsert({ fecha: hoy(), valor })
    if (error) return res.status(500).json({ error: error.message })
    await auditar(req.usuario!.id, 'cambiar_tasa_real', 'tasa_real', hoy(), { valor })
    res.json({ hoy: hoy(), tasa: { fecha: hoy(), valor }, es_de_hoy: true })
  })

  // ── Costos por origen: un solo stock; el costo del producto es el promedio ──
  async function recalcularCosto(productoId: string) {
    const { data: cs } = await db().from('costos_origen').select('costo_cop, costos_variables').eq('producto_id', productoId)
    const n = cs?.length ?? 0
    if (n === 0) return { n }
    const prom = (k: 'costo_cop' | 'costos_variables') => cs.reduce((s: number, c: any) => s + Number(c[k] || 0), 0) / n
    const costo = Math.round(prom('costo_cop'))
    const costos_variables = Math.round(prom('costos_variables'))
    const { data: p } = await db().from('productos').select('precio_venta').eq('id', productoId).single()
    const base = costo + costos_variables
    const margen_pct = base > 0 && p ? Math.round((Number(p.precio_venta) / base - 1) * 100) : 0
    await db().from('productos').update({ costo, costos_variables, margen_pct }).eq('id', productoId)
    return { n, costo, costos_variables, margen_pct }
  }

  app.get('/api/productos/:id/costos', autenticar, gestor, async (req, res) => {
    const { data, error } = await db().from('costos_origen').select('*').eq('producto_id', req.params.id).order('origen')
    if (error) return res.status(500).json({ error: error.message })
    res.json({ costos: data })
  })

  app.post('/api/productos/:id/costos', autenticar, gestor, async (req, res) => {
    const { origen, proveedor, moneda, costo_moneda, tasa, costos_variables } = req.body ?? {}
    if (!['colombia', 'brasil'].includes(origen)) return res.status(400).json({ error: 'Origen inválido' })
    const mon = moneda === 'BRL' ? 'BRL' : 'COP'
    const costo = Number(costo_moneda)
    if (!(costo > 0)) return res.status(400).json({ error: 'Escribe el costo' })

    let t: number | null = null
    if (mon === 'BRL') {
      t = Number(tasa)
      if (!(t > 0)) {
        const { data } = await db().from('tasa_real').select('valor').order('fecha', { ascending: false }).limit(1).maybeSingle()
        t = data ? Number(data.valor) : 0
      }
      if (!(t > 0)) return res.status(400).json({ error: 'Falta la tasa del Real para convertir el costo' })
    }
    const costo_cop = mon === 'BRL' ? Math.round(costo * (t as number)) : costo

    const { error } = await db().from('costos_origen').insert({
      producto_id: req.params.id, origen, proveedor: String(proveedor ?? '').trim() || null,
      moneda: mon, costo_moneda: costo, tasa: t, costo_cop, costos_variables: Number(costos_variables) || 0,
    })
    if (error) return res.status(500).json({ error: error.message })
    const resumen = await recalcularCosto(req.params.id)
    await auditar(req.usuario!.id, 'cambiar_costo', 'productos', req.params.id, { origen, moneda: mon, costo_moneda: costo, tasa: t, costo_cop })
    res.status(201).json({ resumen })
  })

  app.delete('/api/costos/:cid', autenticar, gestor, async (req, res) => {
    const { data: c } = await db().from('costos_origen').select('producto_id').eq('id', req.params.cid).maybeSingle()
    if (!c) return res.status(404).json({ error: 'Costo no encontrado' })
    const { error } = await db().from('costos_origen').delete().eq('id', req.params.cid)
    if (error) return res.status(500).json({ error: error.message })
    res.json({ resumen: await recalcularCosto(c.producto_id) })
  })

  // ── Entrada rápida de mercancía (ej. 5 × Caja) → suma unidades y queda en el kardex ──
  app.post('/api/productos/:id/entrada', autenticar, gestor, async (req, res) => {
    const unidades = Number(req.body?.unidades)
    if (!(unidades > 0)) return res.status(400).json({ error: 'Cantidad inválida' })
    const { data: p } = await db().from('productos').select('existencias').eq('id', req.params.id).maybeSingle()
    if (!p) return res.status(404).json({ error: 'Producto no encontrado' })
    const existencias = Number(p.existencias) + unidades
    const { error } = await db().from('productos').update({ existencias }).eq('id', req.params.id)
    if (error) return res.status(500).json({ error: error.message })
    await registrarMovimiento(req.params.id, 'entrada', unidades, req.usuario!.id, String(req.body?.referencia ?? 'entrada').slice(0, 60))
    res.json({ existencias })
  })

  // (Las ventas y la caja están en rutas/ventas.ts)
}
