import type { Express } from 'express'
import { autenticar, requiereRol } from '../auth.ts'
import { hoy, diaDe, inicioDia, finDia, primerDiaMes, suma } from './comun.ts'

// Gastos, caja menor y flujo de caja (entradas y salidas de dinero por día).

interface Deps {
  db: () => any
  auditar: (usuarioId: string, accion: string, entidad?: string, entidadId?: string, detalle?: unknown) => Promise<void>
}

export const CATEGORIAS_GASTO = ['arriendo', 'servicios', 'nomina', 'transporte', 'mantenimiento', 'impuestos', 'otros']
const PAGA_CON = ['caja', 'caja_menor', 'transferencia']
const fechaValida = (s: unknown) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)

export function registrarGastos(app: Express, { db, auditar }: Deps) {
  const gestor = requiereRol('admin', 'gerencia')

  async function cajaAbierta() {
    const { data } = await db().from('sesiones_caja').select('id').eq('estado', 'abierta').maybeSingle()
    return data
  }
  async function cajaMenor() {
    const { data } = await db().from('caja_menor').select('id, saldo').limit(1).maybeSingle()
    if (data) return data
    const { data: nueva } = await db().from('caja_menor').insert({ saldo: 0 }).select('id, saldo').single()
    return nueva
  }
  const rango = (q: any) => ({
    desde: fechaValida(q.desde) ? String(q.desde) : primerDiaMes(),
    hasta: fechaValida(q.hasta) ? String(q.hasta) : hoy(),
  })

  // ── Gastos ──
  app.get('/api/gastos', autenticar, gestor, async (req, res) => {
    const { desde, hasta } = rango(req.query)
    const { data, error } = await db().from('gastos').select('id, categoria, descripcion, valor, paga_con, fecha, creado_en')
      .gte('fecha', desde).lte('fecha', hasta).order('fecha', { ascending: false }).order('creado_en', { ascending: false })
    if (error) return res.status(500).json({ error: error.message })
    const por_categoria: Record<string, number> = {}
    for (const g of data ?? []) por_categoria[g.categoria] = (por_categoria[g.categoria] ?? 0) + Number(g.valor)
    res.json({ desde, hasta, gastos: data, total: suma(data ?? [], (g) => g.valor), por_categoria })
  })

  app.post('/api/gastos', autenticar, gestor, async (req, res) => {
    const categoria = CATEGORIAS_GASTO.includes(req.body?.categoria) ? req.body.categoria : null
    const valor = Number(req.body?.valor)
    const paga_con = req.body?.paga_con
    const descripcion = String(req.body?.descripcion ?? '').trim() || null
    const fecha = fechaValida(req.body?.fecha) ? req.body.fecha : hoy()
    if (!categoria || !(valor > 0) || !PAGA_CON.includes(paga_con)) {
      return res.status(400).json({ error: 'Categoría, valor y forma de pago son obligatorios' })
    }

    const sesion = paga_con === 'caja' ? await cajaAbierta() : null
    if (paga_con === 'caja' && !sesion) return res.status(409).json({ error: 'Para pagar con la caja del día, primero ábrela' })
    const cm = paga_con === 'caja_menor' ? await cajaMenor() : null
    if (cm && Number(cm.saldo) < valor) {
      return res.status(409).json({ error: `Saldo de caja menor insuficiente ($${Math.round(Number(cm.saldo)).toLocaleString('es-CO')})` })
    }

    const { data: g, error } = await db().from('gastos')
      .insert({ categoria, descripcion, valor, paga_con, fecha, usuario_id: req.usuario!.id }).select('id').single()
    if (error) return res.status(500).json({ error: error.message })
    const concepto = `Gasto: ${categoria}${descripcion ? ' · ' + descripcion : ''}`

    if (sesion) {
      await db().from('movimientos_caja').insert({ sesion_id: sesion.id, tipo: 'egreso', concepto, valor, usuario_id: req.usuario!.id, referencia: `gasto:${g.id}` })
    }
    if (cm) {
      await db().from('movimientos_caja_menor').insert({ tipo: 'gasto', valor, gasto_id: g.id, usuario_id: req.usuario!.id, concepto })
      await db().from('caja_menor').update({ saldo: Number(cm.saldo) - valor }).eq('id', cm.id)
    }
    await auditar(req.usuario!.id, 'registrar_gasto', 'gastos', g.id, { categoria, valor, paga_con })
    res.status(201).json({ ok: true })
  })

  // ── Caja menor ──
  app.get('/api/caja-menor', autenticar, gestor, async (_req, res) => {
    const cm = await cajaMenor()
    const { data: movs } = await db().from('movimientos_caja_menor')
      .select('id, tipo, valor, concepto, origen, creado_en').order('creado_en', { ascending: false }).limit(30)
    res.json({ saldo: Number(cm.saldo), movimientos: movs ?? [] })
  })

  app.post('/api/caja-menor/reponer', autenticar, gestor, async (req, res) => {
    const valor = Number(req.body?.valor)
    const origen = req.body?.origen === 'caja' ? 'caja' : 'transferencia'
    if (!(valor > 0)) return res.status(400).json({ error: 'Escribe el valor a reponer' })
    const sesion = origen === 'caja' ? await cajaAbierta() : null
    if (origen === 'caja' && !sesion) return res.status(409).json({ error: 'Para reponer desde la caja del día, primero ábrela' })

    const cm = await cajaMenor()
    if (sesion) {
      await db().from('movimientos_caja').insert({ sesion_id: sesion.id, tipo: 'egreso', concepto: 'Reposición caja menor', valor, usuario_id: req.usuario!.id, referencia: 'caja_menor' })
    }
    await db().from('movimientos_caja_menor').insert({ tipo: 'reposicion', valor, origen, usuario_id: req.usuario!.id, concepto: 'Reposición' })
    const saldo = Number(cm.saldo) + valor
    await db().from('caja_menor').update({ saldo }).eq('id', cm.id)
    await auditar(req.usuario!.id, 'reponer_caja_menor', 'caja_menor', cm.id, { valor, origen })
    res.json({ saldo })
  })

  // ── Flujo de caja ──
  // Entradas: ventas (todos los medios) + entradas manuales de caja.
  // Salidas: compras pagadas + gastos (caja/transferencia) + reposiciones de caja menor + salidas manuales de caja.
  // (Los movimientos de caja creados por compras/gastos/caja menor no se cuentan dos veces.)
  app.get('/api/flujo', autenticar, gestor, async (req, res) => {
    const { desde, hasta } = rango(req.query)
    const [ventas, movs, compras, gastos, repos] = await Promise.all([
      db().from('ventas').select('total, medio_pago, creado_en, vendida_en').eq('estado', 'activa')
        .gte('creado_en', inicioDia(desde)).lte('creado_en', finDia(hasta)),
      db().from('movimientos_caja').select('tipo, valor, creado_en').is('referencia', null)
        .gte('creado_en', inicioDia(desde)).lte('creado_en', finDia(hasta)),
      db().from('compras').select('total, pagada_en').eq('estado_pago', 'pagada')
        .gte('pagada_en', inicioDia(desde)).lte('pagada_en', finDia(hasta)),
      db().from('gastos').select('valor, fecha').neq('paga_con', 'caja_menor').gte('fecha', desde).lte('fecha', hasta),
      db().from('movimientos_caja_menor').select('valor, creado_en').eq('tipo', 'reposicion')
        .gte('creado_en', inicioDia(desde)).lte('creado_en', finDia(hasta)),
    ])
    for (const r of [ventas, movs, compras, gastos, repos]) if (r.error) return res.status(500).json({ error: r.error.message })

    const vacio = (fecha: string) => ({ fecha, ventas: 0, otros_ingresos: 0, compras: 0, gastos: 0, caja_menor: 0, otros_egresos: 0 })
    const mapa = new Map<string, any>()
    const sumar = (fecha: string, campo: string, valor: unknown) => {
      const d = mapa.get(fecha) ?? vacio(fecha)
      d[campo] += Number(valor) || 0
      mapa.set(fecha, d)
    }
    const por_medio: Record<string, number> = {}
    for (const v of ventas.data ?? []) {
      sumar(diaDe(v.vendida_en ?? v.creado_en), 'ventas', v.total)
      por_medio[v.medio_pago] = (por_medio[v.medio_pago] ?? 0) + Number(v.total)
    }
    for (const m of movs.data ?? []) sumar(diaDe(m.creado_en), m.tipo === 'ingreso' ? 'otros_ingresos' : 'otros_egresos', m.valor)
    for (const c of compras.data ?? []) sumar(diaDe(c.pagada_en), 'compras', c.total)
    for (const g of gastos.data ?? []) sumar(g.fecha, 'gastos', g.valor)
    for (const r of repos.data ?? []) sumar(diaDe(r.creado_en), 'caja_menor', r.valor)

    const dias = [...mapa.values()].sort((a, b) => a.fecha.localeCompare(b.fecha))
    let acumulado = 0
    for (const d of dias) {
      d.entradas = d.ventas + d.otros_ingresos
      d.salidas = d.compras + d.gastos + d.caja_menor + d.otros_egresos
      d.neto = d.entradas - d.salidas
      acumulado += d.neto
      d.acumulado = acumulado
    }
    const totales: Record<string, number> = {}
    for (const k of ['ventas', 'otros_ingresos', 'compras', 'gastos', 'caja_menor', 'otros_egresos', 'entradas', 'salidas', 'neto']) {
      totales[k] = suma(dias, (d) => d[k])
    }
    res.json({ desde, hasta, dias, totales, por_medio })
  })
}
