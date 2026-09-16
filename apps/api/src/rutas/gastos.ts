import type { Express } from 'express'
import { autenticar, requiereRol } from '../auth.ts'
import { hoy, diaDe, inicioDia, finDia, primerDiaMes, suma } from './comun.ts'

// Gastos, caja menor y flujo de caja (entradas y salidas de dinero por día).

interface Deps {
  db: () => any
  auditar: (usuarioId: string, accion: string, entidad?: string, entidadId?: string, detalle?: unknown) => Promise<void>
}

export const CATEGORIAS_GASTO = ['arriendo', 'servicios', 'nomina', 'transporte', 'mantenimiento', 'impuestos', 'otros']
// De la caja del día no sale plata: los gastos se pagan con la caja menor, Nequi o Bold.
const PAGA_CON = ['caja_menor', 'nequi', 'bold']
const fechaValida = (s: unknown) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)

export function registrarGastos(app: Express, { db, auditar }: Deps) {
  const gestor = requiereRol('admin', 'gerencia')

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

    const cm = paga_con === 'caja_menor' ? await cajaMenor() : null
    if (cm && Number(cm.saldo) < valor) {
      return res.status(409).json({ error: `Saldo de caja menor insuficiente ($${Math.round(Number(cm.saldo)).toLocaleString('es-CO')})` })
    }

    const { data: g, error } = await db().from('gastos')
      .insert({ categoria, descripcion, valor, paga_con, fecha, usuario_id: req.usuario!.id }).select('id').single()
    if (error) {
      if (error.code === '23514') return res.status(409).json({ error: 'Para pagar gastos con Nequi o Bold falta aplicar la actualización 0013 de la base de datos' })
      return res.status(500).json({ error: error.message })
    }
    const concepto = `Gasto: ${categoria}${descripcion ? ' · ' + descripcion : ''}`

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
    const [{ data: movs }, { data: arqueos }] = await Promise.all([
      db().from('movimientos_caja_menor')
        .select('id, tipo, valor, concepto, origen, creado_en').order('creado_en', { ascending: false }).limit(30),
      // Los conteos quedan en la bitácora: son una revisión, no mueven plata por sí solos.
      db().from('auditoria').select('detalle, creado_en, usuario:usuarios(nombre)')
        .eq('accion', 'arqueo_caja_menor').order('creado_en', { ascending: false }).limit(5),
    ])
    res.json({ saldo: Number(cm.saldo), movimientos: movs ?? [], arqueos: arqueos ?? [] })
  })

  app.post('/api/caja-menor/reponer', autenticar, gestor, async (req, res) => {
    const valor = Number(req.body?.valor)
    // Desde la cuenta. El efectivo de la caja del día pasa a la caja menor solo al cerrar la caja.
    const origen = 'transferencia'
    if (!(valor > 0)) return res.status(400).json({ error: 'Escribe el valor a reponer' })

    const cm = await cajaMenor()
    await db().from('movimientos_caja_menor').insert({ tipo: 'reposicion', valor, origen, usuario_id: req.usuario!.id, concepto: 'Reposición' })
    const saldo = Number(cm.saldo) + valor
    await db().from('caja_menor').update({ saldo }).eq('id', cm.id)
    await auditar(req.usuario!.id, 'reponer_caja_menor', 'caja_menor', cm.id, { valor, origen })
    res.json({ saldo })
  })

  // Conteo (arqueo) de la caja menor: compara lo que hay en el sobre con el saldo del sistema.
  // Si se decide registrar la diferencia, un faltante entra como gasto (es plata que se fue y
  // debe bajar la ganancia) y un sobrante vuelve al saldo. El saldo queda en lo contado.
  app.post('/api/caja-menor/arqueo', autenticar, gestor, async (req, res) => {
    const crudo = req.body?.contado
    const contado = Number(crudo)
    if (crudo === undefined || crudo === null || crudo === '' || !Number.isFinite(contado) || contado < 0) {
      return res.status(400).json({ error: 'Escribe cuánto hay en la caja menor' })
    }
    const cm = await cajaMenor()
    const saldo = Number(cm.saldo)
    const diferencia = Math.round(contado - saldo)
    const registrada = req.body?.registrar === true && diferencia !== 0
    const usuario_id = req.usuario!.id

    if (registrada && diferencia < 0) {
      const valor = -diferencia
      const descripcion = 'Faltante en conteo de caja menor'
      const { data: g, error } = await db().from('gastos')
        .insert({ categoria: 'otros', descripcion, valor, paga_con: 'caja_menor', fecha: hoy(), usuario_id }).select('id').single()
      if (error) return res.status(500).json({ error: error.message })
      await db().from('movimientos_caja_menor').insert({ tipo: 'gasto', valor, gasto_id: g.id, usuario_id, concepto: 'Gasto: otros · ' + descripcion })
    }
    if (registrada && diferencia > 0) {
      // Sin origen: no salió de la caja ni del banco, así que el flujo de caja no la cuenta.
      await db().from('movimientos_caja_menor').insert({ tipo: 'reposicion', valor: diferencia, usuario_id, concepto: 'Sobrante en conteo de caja menor' })
    }
    if (registrada) await db().from('caja_menor').update({ saldo: contado }).eq('id', cm.id)

    await auditar(usuario_id, 'arqueo_caja_menor', 'caja_menor', cm.id, { saldo_sistema: saldo, contado, diferencia, registrada })
    res.json({ saldo_sistema: saldo, contado, diferencia, registrada, saldo: registrada ? contado : saldo })
  })

  // ── Flujo de caja ──
  // Entradas: ventas (todos los medios) + entradas manuales de caja.
  // Salidas: compras pagadas + gastos (con caja menor, Nequi o Bold) + salidas manuales de caja de antes.
  // Pasar plata de la caja o de la cuenta a la caja menor no es una salida: la plata sigue en el negocio
  // y sale cuando se paga algo con ella. (Los movimientos de caja creados por compras/gastos no se cuentan dos veces.)
  app.get('/api/flujo', autenticar, gestor, async (req, res) => {
    const { desde, hasta } = rango(req.query)
    const [ventas, movs, compras, gastos, tasasReal] = await Promise.all([
      db().from('ventas').select('id, total, medio_pago, creado_en, vendida_en').eq('estado', 'activa')
        .gte('creado_en', inicioDia(desde)).lte('creado_en', finDia(hasta)),
      db().from('movimientos_caja').select('*').is('referencia', null)
        .gte('creado_en', inicioDia(desde)).lte('creado_en', finDia(hasta)),
      db().from('compras').select('total, pagada_en').eq('estado_pago', 'pagada')
        .gte('pagada_en', inicioDia(desde)).lte('pagada_en', finDia(hasta)),
      db().from('gastos').select('valor, fecha').gte('fecha', desde).lte('fecha', hasta),
      db().from('tasa_real').select('fecha, valor').lte('fecha', hasta).order('fecha'),
    ])
    for (const r of [ventas, movs, compras, gastos, tasasReal]) if (r.error) return res.status(500).json({ error: r.error.message })

    const vacio = (fecha: string) => ({ fecha, ventas: 0, otros_ingresos: 0, compras: 0, gastos: 0, otros_egresos: 0 })
    const mapa = new Map<string, any>()
    const sumar = (fecha: string, campo: string, valor: unknown) => {
      const d = mapa.get(fecha) ?? vacio(fecha)
      d[campo] += Number(valor) || 0
      mapa.set(fecha, d)
    }
    const por_medio: Record<string, number> = {}
    for (const v of ventas.data ?? []) {
      sumar(diaDe(v.vendida_en ?? v.creado_en), 'ventas', v.total)
      if (v.medio_pago !== 'mixto') por_medio[v.medio_pago] = (por_medio[v.medio_pago] ?? 0) + Number(v.total)
    }
    // Pagos divididos: cada parte suma a su medio.
    const idsMixtas = (ventas.data ?? []).filter((v: any) => v.medio_pago === 'mixto').map((v: any) => v.id)
    if (idsMixtas.length) {
      const { data: partes } = await db().from('venta_pagos').select('medio, valor_pesos').in('venta_id', idsMixtas)
      for (const p of partes ?? []) por_medio[p.medio] = (por_medio[p.medio] ?? 0) + Number(p.valor_pesos)
    }
    // Entradas/salidas manuales en reales se pasan a pesos con la tasa de ese día (o la última anterior).
    const tasas = tasasReal.data ?? []
    const tasaDelDia = (fecha: string) => Number([...tasas].reverse().find((t: any) => t.fecha <= fecha)?.valor ?? tasas[0]?.valor ?? 0)
    for (const m of movs.data ?? []) {
      const fecha = diaDe(m.creado_en)
      const valor = m.moneda === 'BRL' ? Number(m.valor) * tasaDelDia(fecha) : m.valor
      sumar(fecha, m.tipo === 'ingreso' ? 'otros_ingresos' : 'otros_egresos', valor)
    }
    for (const c of compras.data ?? []) sumar(diaDe(c.pagada_en), 'compras', c.total)
    for (const g of gastos.data ?? []) sumar(g.fecha, 'gastos', g.valor)

    const dias = [...mapa.values()].sort((a, b) => a.fecha.localeCompare(b.fecha))
    let acumulado = 0
    for (const d of dias) {
      d.entradas = d.ventas + d.otros_ingresos
      d.salidas = d.compras + d.gastos + d.otros_egresos
      d.neto = d.entradas - d.salidas
      acumulado += d.neto
      d.acumulado = acumulado
    }
    const totales: Record<string, number> = {}
    for (const k of ['ventas', 'otros_ingresos', 'compras', 'gastos', 'otros_egresos', 'entradas', 'salidas', 'neto']) {
      totales[k] = suma(dias, (d) => d[k])
    }
    res.json({ desde, hasta, dias, totales, por_medio })
  })
}
