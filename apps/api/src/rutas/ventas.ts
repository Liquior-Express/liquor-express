import type { Express } from 'express'
import { autenticar, requiereRol, veUtilidad } from '../auth.ts'
import { hoy, r2, a50, suma, inicioDia, finDia, descontarLotes, hayEmpaques, hayClientes, SIN_0014 } from './comun.ts'
import { moverEmpaques } from './empaques.ts'

// Ventas rápidas, historial/anulación y Caja (apertura, entradas/salidas, cierre en pesos y reales).
// Terminal único: solo hay una caja abierta a la vez y toda venta pertenece a ella.

interface Deps {
  db: () => any
  auditar: (usuarioId: string, accion: string, entidad?: string, entidadId?: string, detalle?: unknown) => Promise<void>
  registrarMovimiento: (productoId: string, tipo: 'entrada' | 'venta' | 'merma' | 'ajuste' | 'apertura', cantidad: number, usuarioId: string, referencia?: string) => Promise<void>
}

const MEDIOS = ['efectivo', 'nequi', 'bold', 'pix']
const fechaValida = (s: unknown) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
const COLS_VENTA = 'id, total, medio_pago, valor_reales, tasa_real, moneda_efectivo, cambio, cambio_en, creado_en'

// Partes de un pago dividido, ya validadas: cuánto se recibió en su moneda y cuánto aporta al total.
interface Parte { medio: string; moneda: 'COP' | 'BRL'; monto: number; valor_pesos: number }

// Lo que cada medio aporta a las ventas de una lista (las divididas se reparten por partes).
// `pagos` son las partes de las ventas divididas de la lista.
function porMedio(ventas: any[], pagos: any[]) {
  const r: Record<string, number> = {}
  for (const v of ventas) if (v.medio_pago !== 'mixto') r[v.medio_pago] = (r[v.medio_pago] ?? 0) + Number(v.total)
  for (const p of pagos) r[p.medio] = (r[p.medio] ?? 0) + Number(p.valor_pesos)
  return r
}

// Un cajero solo corrige o borra sus propias ventas; administración y gerencia, cualquiera.
const puedeTocar = (usuario: { id: string; rol: string }, v: { usuario_id: string | null }) =>
  usuario.rol !== 'cajero' || v.usuario_id === usuario.id

export function registrarVentasYCaja(app: Express, { db, auditar, registrarMovimiento }: Deps) {
  const gestor = requiereRol('admin', 'gerencia')

  async function cajaAbierta() {
    const { data } = await db().from('sesiones_caja').select('*').eq('estado', 'abierta').maybeSingle()
    return data
  }
  async function tasaDeHoy(): Promise<number | null> {
    const { data } = await db().from('tasa_real').select('valor').eq('fecha', hoy()).maybeSingle()
    return data ? Number(data.valor) : null
  }

  // Partes de las ventas divididas de una lista (vacío si no hay ninguna).
  async function pagosDe(ventas: any[]): Promise<any[]> {
    const ids = ventas.filter((v) => v.medio_pago === 'mixto').map((v) => v.id)
    if (!ids.length) return []
    const { data } = await db().from('venta_pagos').select('venta_id, medio, moneda, monto, valor_pesos').in('venta_id', ids)
    return data ?? []
  }

  // Resumen de una sesión: ventas activas por medio y efectivo esperado en pesos y en reales.
  async function resumenSesion(s: any) {
    const [{ data: ventas }, { data: movs }] = await Promise.all([
      db().from('ventas').select('id, total, utilidad, medio_pago, valor_reales, moneda_efectivo, efectivo_recibido, cambio, cambio_en')
        .eq('sesion_id', s.id).eq('estado', 'activa'),
      db().from('movimientos_caja').select('*').eq('sesion_id', s.id).order('creado_en'),
    ])
    const v = ventas ?? []
    const m = movs ?? []
    // Pagos divididos: cada parte va a su medio; el efectivo recibido entra a su cajón y el cambio sale del cajón en que se dio.
    const partes = await pagosDe(v)
    const mixtas = v.filter((x: any) => x.medio_pago === 'mixto')
    const deParte = (f: (p: any) => boolean, campo: 'monto' | 'valor_pesos') => suma(partes.filter(f), (p) => p[campo])
    const efParte = (moneda: string) => (p: any) => p.medio === 'efectivo' && p.moneda === moneda
    const cambioMixto = (moneda: string) => suma(mixtas.filter((x: any) => x.cambio && x.cambio_en === moneda), (x) => x.cambio)
    const mixto = {
      efectivo: deParte(efParte('COP'), 'valor_pesos'),
      efectivo_reales_pesos: deParte(efParte('BRL'), 'valor_pesos'),
      efectivo_reales: r2(deParte(efParte('BRL'), 'monto') - cambioMixto('BRL')),
      nequi: deParte((p) => p.medio === 'nequi', 'valor_pesos'),
      bold: deParte((p) => p.medio === 'bold', 'valor_pesos'),
      pix: deParte((p) => p.medio === 'pix', 'valor_pesos'),
      pix_reales: r2(deParte((p) => p.medio === 'pix', 'monto')),
      cajon_pesos: deParte(efParte('COP'), 'monto') - cambioMixto('COP'),
    }
    const efCop = v.filter((x: any) => x.medio_pago === 'efectivo' && x.moneda_efectivo !== 'BRL')
    const efBrl = v.filter((x: any) => x.medio_pago === 'efectivo' && x.moneda_efectivo === 'BRL')
    const pix = v.filter((x: any) => x.medio_pago === 'pix')
    // Entradas y salidas manuales: cada una va a su propio cajón (pesos o reales).
    const enPesos = m.filter((x: any) => x.moneda !== 'BRL')
    const enReales = m.filter((x: any) => x.moneda === 'BRL')
    const ingresos = suma(enPesos.filter((x: any) => x.tipo === 'ingreso'), (x) => x.valor)
    const egresos = suma(enPesos.filter((x: any) => x.tipo === 'egreso'), (x) => x.valor)
    const ingresosReales = r2(suma(enReales.filter((x: any) => x.tipo === 'ingreso'), (x) => x.valor))
    const egresosReales = r2(suma(enReales.filter((x: any) => x.tipo === 'egreso'), (x) => x.valor))
    // Pago en reales con cambio en pesos: entran los reales recibidos y salen pesos del cajón.
    const cambioPesosDeReales = suma(efBrl.filter((x: any) => x.cambio_en === 'COP'), (x) => x.cambio)
    const realesQueEntraron = suma(efBrl, (x) => (x.cambio_en === 'COP' && x.efectivo_recibido ? x.efectivo_recibido : x.valor_reales))

    return {
      ventas: { cantidad: v.length, total: suma(v, (x) => x.total), utilidad: suma(v, (x) => x.utilidad) },
      por_medio: {
        efectivo: suma(efCop, (x) => x.total) + mixto.efectivo,
        efectivo_reales: {
          pesos: suma(efBrl, (x) => x.total) + mixto.efectivo_reales_pesos,
          reales: r2(suma(efBrl, (x) => x.valor_reales) + mixto.efectivo_reales),
        },
        nequi: suma(v.filter((x: any) => x.medio_pago === 'nequi'), (x) => x.total) + mixto.nequi,
        bold: suma(v.filter((x: any) => x.medio_pago === 'bold'), (x) => x.total) + mixto.bold,
        pix: { pesos: suma(pix, (x) => x.total) + mixto.pix, reales: r2(suma(pix, (x) => x.valor_reales) + mixto.pix_reales) },
      },
      divididas: mixtas.length,
      ingresos, egresos, ingresos_reales: ingresosReales, egresos_reales: egresosReales, movimientos: m,
      esperado_efectivo: Math.round(Number(s.base_apertura) + suma(efCop, (x) => x.total) + mixto.cajon_pesos - cambioPesosDeReales + ingresos - egresos),
      esperado_reales: r2(Number(s.base_reales) + realesQueEntraron + mixto.efectivo_reales + ingresosReales - egresosReales),
    }
  }
  const sinUtilidad = (r: any, ve: boolean) => (ve ? r : { ...r, ventas: { cantidad: r.ventas.cantidad, total: r.ventas.total } })

  // ── Caja ──
  app.get('/api/caja/actual', autenticar, async (req, res) => {
    const s = await cajaAbierta()
    if (!s) return res.json({ abierta: false, tasa: await tasaDeHoy() })
    const [{ data: u }, r, tasa] = await Promise.all([
      db().from('usuarios').select('nombre').eq('id', s.usuario_id).maybeSingle(),
      resumenSesion(s),
      tasaDeHoy(),
    ])
    res.json({
      abierta: true, tasa,
      sesion: {
        id: s.id, fecha_jornada: s.fecha_jornada, apertura: s.apertura, base_apertura: Number(s.base_apertura),
        base_reales: Number(s.base_reales), abierta_por: u?.nombre ?? null,
      },
      resumen: sinUtilidad(r, veUtilidad(req.usuario!.rol)),
    })
  })

  app.post('/api/caja/abrir', autenticar, async (req, res) => {
    if (await cajaAbierta()) return res.status(409).json({ error: 'Ya hay una caja abierta' })
    const base = Number(req.body?.base) || 0
    const base_reales = Number(req.body?.base_reales) || 0
    if (base < 0 || base_reales < 0) return res.status(400).json({ error: 'La base no puede ser negativa' })
    // Jornada: el día al que pertenecen las ventas de esta caja (aunque se cierre después de medianoche).
    const fecha_jornada = fechaValida(req.body?.fecha_jornada) ? req.body.fecha_jornada : hoy()
    const { data, error } = await db().from('sesiones_caja')
      .insert({ usuario_id: req.usuario!.id, base_apertura: base, base_reales, estado: 'abierta', fecha_jornada }).select('id').single()
    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'Ya hay una caja abierta' })
      return res.status(500).json({ error: error.message })
    }
    await auditar(req.usuario!.id, 'abrir_caja', 'sesiones_caja', data.id, { base, base_reales })
    res.status(201).json({ ok: true })
  })

  app.post('/api/caja/movimiento', autenticar, async (req, res) => {
    const s = await cajaAbierta()
    if (!s) return res.status(409).json({ error: 'La caja está cerrada' })
    const tipo = req.body?.tipo
    const moneda = req.body?.moneda === 'BRL' ? 'BRL' : 'COP'
    const valor = r2(Number(req.body?.valor))
    const concepto = String(req.body?.concepto ?? '').trim()
    if (!['ingreso', 'egreso'].includes(tipo) || !(valor > 0) || !concepto) {
      return res.status(400).json({ error: 'Tipo, concepto y valor son obligatorios' })
    }
    // De la caja del día no sale plata: compras y gastos se pagan con la caja menor, Nequi o Bold,
    // y el efectivo pasa a la caja menor al cerrar.
    if (tipo === 'egreso') {
      return res.status(409).json({ error: 'De la caja no sale plata. Los pagos van por caja menor, Nequi o Bold, y el efectivo pasa a la caja menor al cerrar la caja.' })
    }
    // Pesos es el valor por defecto de la columna; la moneda solo se envía cuando es en reales.
    const { error } = await db().from('movimientos_caja')
      .insert({ sesion_id: s.id, tipo, concepto, valor, usuario_id: req.usuario!.id, ...(moneda === 'BRL' ? { moneda } : {}) })
    if (error) {
      if (moneda === 'BRL' && /moneda/i.test(error.message)) {
        return res.status(409).json({ error: 'Para registrar en reales falta aplicar la actualización 0011 de la base de datos.' })
      }
      return res.status(500).json({ error: error.message })
    }
    await auditar(req.usuario!.id, 'movimiento_caja', 'sesiones_caja', s.id, { tipo, concepto, valor, moneda })
    res.status(201).json({ ok: true })
  })

  app.post('/api/caja/cerrar', autenticar, async (req, res) => {
    const s = await cajaAbierta()
    if (!s) return res.status(409).json({ error: 'La caja ya está cerrada' })
    if (req.body?.contado_efectivo === undefined || req.body?.contado_efectivo === '') {
      return res.status(400).json({ error: 'Escribe el efectivo contado en pesos' })
    }
    const contado = Number(req.body.contado_efectivo)
    const contadoR = Number(req.body?.contado_reales) || 0
    if (!(contado >= 0) || contadoR < 0) return res.status(400).json({ error: 'Conteo inválido' })
    // Al cerrar, el efectivo en pesos pasa a la caja menor: por defecto todo lo contado; si se deja base
    // para el día siguiente, pasa menos. Los reales se quedan en el cajón (la caja menor es en pesos).
    const crudoMenor = req.body?.a_caja_menor
    const aCajaMenor = crudoMenor === undefined || crudoMenor === null || crudoMenor === '' ? contado : Math.round(Number(crudoMenor))
    if (!(aCajaMenor >= 0) || aCajaMenor > contado) return res.status(400).json({ error: 'Lo que pasa a la caja menor no puede ser más que el efectivo contado' })

    const r = await resumenSesion(s)
    const cierre = {
      estado: 'cerrada', cierre: new Date().toISOString(), cerrada_por: req.usuario!.id,
      total_ventas: r.ventas.total, total_efectivo: r.por_medio.efectivo, total_efectivo_reales: r.por_medio.efectivo_reales.reales,
      total_nequi: r.por_medio.nequi, total_bold: r.por_medio.bold, total_pix: r.por_medio.pix.pesos,
      total_ingresos: r.ingresos, total_egresos: r.egresos,
      esperado_caja: r.esperado_efectivo, esperado_reales: r.esperado_reales,
      contado_efectivo: contado, contado_reales: contadoR,
      diferencia: Math.round(contado - r.esperado_efectivo), diferencia_reales: r2(contadoR - r.esperado_reales),
      tasa_real: await tasaDeHoy(), observaciones: String(req.body?.observaciones ?? '').trim() || null,
    }
    const { error } = await db().from('sesiones_caja').update(cierre).eq('id', s.id)
    if (error) return res.status(500).json({ error: error.message })
    if (aCajaMenor > 0) {
      let { data: cm } = await db().from('caja_menor').select('id, saldo').limit(1).maybeSingle()
      if (!cm) cm = (await db().from('caja_menor').insert({ saldo: 0 }).select('id, saldo').single()).data
      await db().from('movimientos_caja_menor').insert({ tipo: 'reposicion', valor: aCajaMenor, origen: 'caja', usuario_id: req.usuario!.id, concepto: `Cierre de caja · jornada ${s.fecha_jornada}` })
      await db().from('caja_menor').update({ saldo: Number(cm.saldo) + aCajaMenor }).eq('id', cm.id)
    }
    await auditar(req.usuario!.id, 'cerrar_caja', 'sesiones_caja', s.id, {
      esperado: r.esperado_efectivo, contado, diferencia: cierre.diferencia, diferencia_reales: cierre.diferencia_reales, a_caja_menor: aCajaMenor,
    })
    res.json({ cierre: { ...cierre, a_caja_menor: aCajaMenor, fecha_jornada: s.fecha_jornada, apertura: s.apertura, base_apertura: Number(s.base_apertura), base_reales: Number(s.base_reales), resumen: sinUtilidad(r, veUtilidad(req.usuario!.rol)) } })
  })

  // Historial de cierres, filtrable por fecha de jornada (por defecto, los últimos 30 días).
  app.get('/api/caja/historial', autenticar, gestor, async (req, res) => {
    const hasta = fechaValida(req.query.hasta) ? String(req.query.hasta) : hoy()
    const desde = fechaValida(req.query.desde) ? String(req.query.desde)
      : new Date(Date.now() - 29 * 864e5).toLocaleDateString('en-CA', { timeZone: 'America/Bogota' })
    const { data, error } = await db().from('sesiones_caja')
      .select('id, fecha_jornada, apertura, cierre, base_apertura, total_ventas, total_efectivo, total_nequi, total_bold, total_pix, esperado_caja, contado_efectivo, diferencia, esperado_reales, contado_reales, diferencia_reales, observaciones')
      .eq('estado', 'cerrada').gte('fecha_jornada', desde).lte('fecha_jornada', hasta)
      .order('fecha_jornada', { ascending: false }).order('cierre', { ascending: false }).limit(100)
    if (error) return res.status(500).json({ error: error.message })
    res.json({ sesiones: data })
  })

  // ── Ventas rápidas ──
  app.post('/api/ventas', autenticar, async (req, res) => {
    const b = req.body ?? {}
    // Ventas hechas sin conexión llegan con un id del equipo: si ya se registró, no se duplica.
    const cliente_id = typeof b.cliente_id === 'string' && b.cliente_id ? b.cliente_id.slice(0, 64) : null
    const buscarRepetida = async () => {
      if (!cliente_id) return null
      const { data } = await db().from('ventas').select(COLS_VENTA).eq('cliente_id', cliente_id).maybeSingle()
      return data
    }
    const repetida = await buscarRepetida()
    if (repetida) return res.json({ venta: repetida, avisos: [], repetida: true })

    const items: any[] = Array.isArray(b.items) ? b.items : []
    const medio = b.medio_pago
    if (items.length === 0) return res.status(400).json({ error: 'Agrega al menos un producto' })
    if (!MEDIOS.includes(medio) && medio !== 'mixto') return res.status(400).json({ error: 'Medio de pago inválido' })

    const sesion = await cajaAbierta()
    if (!sesion) return res.status(409).json({ error: 'La caja está cerrada. Ábrela en el módulo Caja para vender.' })

    // Clientes y pagos divididos necesitan la actualización 0014.
    const conClientes = await hayClientes(db)
    const comprador_id = typeof b.comprador_id === 'string' && b.comprador_id ? b.comprador_id : null
    if ((medio === 'mixto' || comprador_id) && !conClientes) return res.status(409).json({ error: SIN_0014 })
    if (comprador_id) {
      const { data: c } = await db().from('clientes').select('id').eq('id', comprador_id).maybeSingle()
      if (!c) return res.status(400).json({ error: 'El cliente de la venta no existe' })
    }

    // Corrección: la venta nueva reemplaza a otra de la misma caja, que queda anulada.
    let original: any = null
    if (typeof b.reemplaza_id === 'string' && b.reemplaza_id) {
      const { data } = await db().from('ventas').select('id, estado, sesion_id, total, usuario_id').eq('id', b.reemplaza_id).maybeSingle()
      if (!data) return res.status(404).json({ error: 'La venta que se está corrigiendo no existe' })
      if (data.estado === 'anulada') return res.status(409).json({ error: 'La venta que se está corrigiendo ya fue anulada' })
      if (data.sesion_id !== sesion.id) return res.status(409).json({ error: 'Solo se corrigen ventas de la caja abierta (antes del cierre)' })
      if (!puedeTocar(req.usuario!, data)) return res.status(403).json({ error: 'Solo puedes corregir tus propias ventas' })
      original = data
    }

    const ids = [...new Set(items.map((i) => String(i.producto_id)))]
    const emp = await hayEmpaques(db)
    const { data: prods, error: e1 } = await db().from('productos')
      .select('id, nombre, precio_venta, costo, costos_variables, existencias, es_pola, activo, controla_vencimiento' + (emp ? ', controla_empaques' : '')).in('id', ids)
    if (e1) return res.status(500).json({ error: e1.message })
    const presIds = items.map((i) => i.presentacion_id).filter(Boolean)
    const { data: pres } = presIds.length
      ? await db().from('presentaciones').select('id, producto_id, nombre, factor_unidades, precio').in('id', presIds)
      : { data: [] as any[] }

    const lineas: any[] = []
    for (const i of items) {
      const p = prods?.find((x: any) => x.id === i.producto_id)
      if (!p || !p.activo) return res.status(400).json({ error: 'Hay un producto que no existe o está inactivo' })
      const pr = i.presentacion_id ? pres?.find((x: any) => x.id === i.presentacion_id && x.producto_id === p.id) : null
      if (i.presentacion_id && !pr) return res.status(400).json({ error: 'Presentación inválida' })
      const cantidad = Number(i.cantidad)
      if (!(cantidad > 0)) return res.status(400).json({ error: 'Cantidad inválida' })
      const factor = pr ? Number(pr.factor_unidades) : 1
      const precio_unitario = pr ? (Number(pr.precio) || Number(p.precio_venta) * factor) : Number(p.precio_venta)
      const costo_unitario = ((Number(p.costo) || 0) + (Number(p.costos_variables) || 0)) * factor
      lineas.push({ p, pr, cantidad, factor, precio_unitario, costo_unitario })
    }
    const total = lineas.reduce((s, l) => s + l.precio_unitario * l.cantidad, 0)
    const costoTotal = lineas.reduce((s, l) => s + l.costo_unitario * l.cantidad, 0)

    // Empaques que se abrieron para vender sueltos (cigarrillos): deben ser del producto vendido.
    const aperturas: { p: any; pr: any }[] = []
    if (emp && Array.isArray(b.aperturas) && b.aperturas.length) {
      const idsPres = [...new Set(b.aperturas.map((a: any) => String(a?.presentacion_id)))] as string[]
      const { data: presA } = await db().from('presentaciones').select('id, producto_id, nombre, factor_unidades').in('id', idsPres)
      for (const a of b.aperturas) {
        const p = prods?.find((x: any) => x.id === a?.producto_id)
        const pr = presA?.find((x: any) => x.id === a?.presentacion_id && x.producto_id === a?.producto_id)
        if (!p || !pr || !p.controla_empaques) return res.status(400).json({ error: 'Apertura de empaque inválida' })
        aperturas.push({ p, pr })
      }
    }

    // Pago: PIX y efectivo en reales usan la tasa de hoy; el efectivo guarda recibido y cambio.
    let tasa: number | null = null
    let valor_reales: number | null = null
    let moneda_efectivo: string | null = null
    let efectivo_recibido: number | null = null
    let cambio: number | null = null
    let cambio_en: string | null = null
    let partes: Parte[] = []
    if (medio === 'mixto') {
      const crudas: any[] = Array.isArray(b.pagos) ? b.pagos : []
      for (const c of crudas) {
        if (!MEDIOS.includes(c?.medio)) return res.status(400).json({ error: 'Hay una parte del pago con un medio inválido' })
        const moneda: 'COP' | 'BRL' = c.medio === 'pix' || (c.medio === 'efectivo' && c.moneda === 'BRL') ? 'BRL' : 'COP'
        const monto = moneda === 'BRL' ? r2(Number(c.monto)) : Math.round(Number(c.monto))
        if (!(monto > 0)) return res.status(400).json({ error: 'Cada parte del pago debe tener un valor' })
        partes.push({ medio: c.medio, moneda, monto, valor_pesos: 0 })
      }
      if (partes.length < 2) return res.status(400).json({ error: 'Un pago dividido necesita al menos dos partes' })
      const conReales = partes.some((p) => p.moneda === 'BRL') || b.cambio_en === 'BRL'
      if (conReales) {
        tasa = await tasaDeHoy()
        if (!tasa) return res.status(400).json({ error: 'Registra primero la tasa del Real de hoy' })
      }
      for (const p of partes) p.valor_pesos = p.moneda === 'BRL' ? Math.round(p.monto * (tasa as number)) : p.monto
      const pagado = suma(partes, (p) => p.valor_pesos)
      // Tolerancia de $50: al pasar reales a pesos puede quedar un redondeo.
      if (total - pagado > 50) return res.status(400).json({ error: `Faltan $${Math.round(total - pagado).toLocaleString('es-CO')} por cobrar` })
      const exceso = pagado - total
      if (exceso > 0) {
        // Lo que sobra es cambio y solo se da de lo recibido en efectivo.
        const efectivo = partes.filter((p) => p.medio === 'efectivo')
        if (suma(efectivo, (p) => p.valor_pesos) < exceso) return res.status(400).json({ error: 'El pago supera el total: el cambio solo se da del efectivo recibido' })
        cambio_en = b.cambio_en === 'BRL' ? 'BRL' : 'COP'
        cambio = cambio_en === 'BRL' ? r2(exceso / (tasa as number)) : a50(exceso)
        // El cambio se descuenta primero de las partes en la moneda en que se devuelve.
        let resto = exceso
        for (const p of [...efectivo].sort((a, c) => Number(c.moneda === cambio_en) - Number(a.moneda === cambio_en))) {
          const quita = Math.min(p.valor_pesos, resto)
          p.valor_pesos -= quita
          resto -= quita
        }
      }
      const reales = partes.filter((p) => p.moneda === 'BRL')
      if (reales.length) valor_reales = r2(suma(reales, (p) => p.monto))
    }
    const enReales = medio === 'pix' || (medio === 'efectivo' && b.efectivo?.moneda === 'BRL')
    if (enReales) {
      tasa = await tasaDeHoy()
      if (!tasa) return res.status(400).json({ error: 'Registra primero la tasa del Real de hoy' })
      valor_reales = r2(total / tasa)
    }
    if (medio === 'efectivo') {
      moneda_efectivo = enReales ? 'BRL' : 'COP'
      const recibido = Number(b.efectivo?.recibido) || 0
      if (recibido > 0) {
        const aPagar = enReales ? (valor_reales as number) : total
        if (recibido < aPagar) return res.status(400).json({ error: 'El dinero recibido no alcanza para el total' })
        efectivo_recibido = recibido
        if (enReales) {
          cambio_en = b.efectivo?.cambio_en === 'COP' ? 'COP' : 'BRL'
          cambio = cambio_en === 'COP' ? a50((recibido - aPagar) * (tasa as number)) : r2(recibido - aPagar)
        } else {
          cambio_en = 'COP'
          cambio = recibido - total
        }
      }
    }
    const vendida_en = typeof b.vendida_en === 'string' && !isNaN(Date.parse(b.vendida_en)) ? new Date(b.vendida_en).toISOString() : null

    const { data: venta, error: e2 } = await db().from('ventas').insert({
      usuario_id: req.usuario!.id, sesion_id: sesion.id, subtotal: total, utilidad: total - costoTotal, total,
      medio_pago: medio, valor_reales, tasa_real: tasa, moneda_efectivo, efectivo_recibido, cambio, cambio_en,
      cliente_id, vendida_en, ...(comprador_id ? { comprador_id } : {}),
    }).select(COLS_VENTA).single()
    if (e2) {
      // Dos envíos simultáneos de la misma venta sin conexión: devolver la que quedó.
      if (e2.code === '23505') { const ya = await buscarRepetida(); if (ya) return res.json({ venta: ya, avisos: [], repetida: true }) }
      return res.status(500).json({ error: e2.message })
    }

    const { error: e3 } = await db().from('venta_items').insert(lineas.map((l) => ({
      venta_id: venta.id, producto_id: l.p.id, presentacion: l.pr ? l.pr.nombre : null, cantidad: l.cantidad,
      unidades: l.cantidad * l.factor, precio_unitario: l.precio_unitario, costo_unitario: l.costo_unitario, es_pola: l.p.es_pola,
    })))
    const e4 = !e3 && partes.length
      ? (await db().from('venta_pagos').insert(partes.map((p) => ({ venta_id: venta.id, ...p })))).error
      : null
    if (e3 || e4) {
      await db().from('ventas').delete().eq('id', venta.id)
      return res.status(500).json({ error: (e3 ?? e4).message })
    }

    // Descontar existencias (en unidades), lotes por vencimiento y dejar el rastro en el kardex.
    // (No se bloquea la venta si el stock queda negativo: se avisa para revisar.)
    const porProducto = new Map<string, { p: any; unidades: number }>()
    for (const l of lineas) {
      const acc = porProducto.get(l.p.id) ?? { p: l.p, unidades: 0 }
      acc.unidades += l.cantidad * l.factor
      porProducto.set(l.p.id, acc)
    }
    const avisos: string[] = []
    for (const { p, unidades } of porProducto.values()) {
      const nueva = Number(p.existencias) - unidades
      await db().from('productos').update({ existencias: nueva }).eq('id', p.id)
      if (p.controla_vencimiento) await descontarLotes(db, p.id, unidades)
      await registrarMovimiento(p.id, 'venta', -unidades, req.usuario!.id, `venta ${String(venta.id).slice(0, 8)}`)
      if (nueva < 0) avisos.push(`${p.nombre} quedó en ${nueva} und: revisa el inventario`)
    }
    // Control por empaques: primero los empaques que se abrieron, luego lo vendido cerrado o suelto.
    if (emp) {
      for (const { p } of porProducto.values()) {
        if (!p.controla_empaques) continue
        const suyas = aperturas.filter((a) => a.p.id === p.id)
        const vendidas = lineas.filter((l) => l.p.id === p.id)
        avisos.push(...await moverEmpaques(db, p, {
          aperturas: suyas.map((a) => ({ presentacion_id: a.pr.id, factor: Number(a.pr.factor_unidades) })),
          cerradas: vendidas.filter((l) => l.pr).map((l) => ({ presentacion_id: l.pr.id, cantidad: -l.cantidad })),
          sueltos: -vendidas.filter((l) => !l.pr).reduce((s, l) => s + l.cantidad, 0),
        }))
        for (const a of suyas) await registrarMovimiento(p.id, 'apertura', 0, req.usuario!.id, `abre ${a.pr.nombre} (${a.pr.factor_unidades} und)`)
      }
    }
    // Corrección: con la venta nueva ya registrada, la original se anula y devuelve lo suyo al inventario.
    if (original) {
      await anularVenta(original, req.usuario!.id, `Corregida: reemplazada por la venta ${String(venta.id).slice(0, 8)}`)
      avisos.unshift('La venta anterior quedó anulada')
    }
    res.status(201).json({ venta, avisos })
  })

  app.get('/api/ventas/hoy', autenticar, async (req, res) => {
    const { data, error } = await db().from('ventas')
      .select('id, total, utilidad, medio_pago, valor_reales, creado_en').eq('estado', 'activa')
      .gte('creado_en', inicioDia(hoy())).order('creado_en', { ascending: false })
    if (error) return res.status(500).json({ error: error.message })
    const ve = veUtilidad(req.usuario!.rol)
    const lista = data ?? []
    res.json({
      ventas: lista.slice(0, 20).map((v: any) => { if (ve) return v; const { utilidad, ...r } = v; return r }),
      resumen: {
        cantidad: lista.length,
        total: suma(lista, (v) => v.total),
        por_medio: porMedio(lista, await pagosDe(lista)),
        ...(ve ? { utilidad: suma(lista, (v) => v.utilidad) } : {}),
      },
    })
  })

  // Ventas de la caja abierta, para revisarlas desde Ventas rápidas y corregir o borrar las que se
  // registraron por error. Trae los productos de cada una y si el usuario puede tocarla.
  app.get('/api/ventas/caja', autenticar, async (req, res) => {
    const s = await cajaAbierta()
    if (!s) return res.json({ abierta: false, ventas: [] })
    const conClientes = await hayClientes(db)
    const { data, error } = await db().from('ventas')
      .select('id, total, medio_pago, valor_reales, moneda_efectivo, estado, creado_en, vendida_en, usuario_id, usuario:usuarios!ventas_usuario_id_fkey(nombre), venta_items(cantidad, presentacion, producto:productos(nombre))'
        + (conClientes ? ', comprador:clientes(nombre)' : ''))
      .eq('sesion_id', s.id).order('creado_en', { ascending: false }).limit(200)
    if (error) return res.status(500).json({ error: error.message })
    res.json({
      abierta: true,
      ventas: (data ?? []).map(({ usuario, comprador, venta_items, ...v }: any) => ({
        ...v, usuario_nombre: usuario?.nombre ?? null, comprador_nombre: comprador?.nombre ?? null,
        items: (venta_items ?? []).map((i: any) => ({ cantidad: Number(i.cantidad), presentacion: i.presentacion, producto_nombre: i.producto?.nombre ?? '' })),
        puede_corregir: v.estado === 'activa' && puedeTocar(req.usuario!, v),
      })),
    })
  })

  // ── Historial de ventas ──
  app.get('/api/ventas', autenticar, async (req, res) => {
    const desde = fechaValida(req.query.desde) ? String(req.query.desde) : hoy()
    const hasta = fechaValida(req.query.hasta) ? String(req.query.hasta) : hoy()
    const conClientes = await hayClientes(db)
    let q = db().from('ventas')
      .select('id, total, utilidad, medio_pago, valor_reales, moneda_efectivo, estado, creado_en, vendida_en, usuario:usuarios!ventas_usuario_id_fkey(nombre)'
        + (conClientes ? ', comprador:clientes(nombre)' : ''))
      .gte('creado_en', inicioDia(desde)).lte('creado_en', finDia(hasta))
      .order('creado_en', { ascending: false }).limit(300)
    if (MEDIOS.includes(String(req.query.medio)) || req.query.medio === 'mixto') q = q.eq('medio_pago', req.query.medio)
    if (req.query.estado === 'activa' || req.query.estado === 'anulada') q = q.eq('estado', req.query.estado)
    const { data, error } = await q
    if (error) return res.status(500).json({ error: error.message })

    const ve = veUtilidad(req.usuario!.rol)
    const lista = (data ?? []).map(({ usuario, comprador, utilidad, ...v }: any) => ({
      ...v, usuario_nombre: usuario?.nombre ?? null, comprador_nombre: comprador?.nombre ?? null, ...(ve ? { utilidad } : {}),
    }))
    const activas = lista.filter((v: any) => v.estado === 'activa')
    res.json({
      desde, hasta, ventas: lista,
      resumen: {
        cantidad: activas.length, total: suma(activas, (v) => v.total), anuladas: lista.length - activas.length,
        ...(ve ? { utilidad: suma(activas, (v) => v.utilidad) } : {}),
      },
    })
  })

  app.get('/api/ventas/:id', autenticar, async (req, res) => {
    const { data: v } = await db().from('ventas').select('*, usuario:usuarios!ventas_usuario_id_fkey(nombre)').eq('id', req.params.id).maybeSingle()
    if (!v) return res.status(404).json({ error: 'Venta no encontrada' })
    const [{ data: items }, s, pagos, comprador] = await Promise.all([
      db().from('venta_items').select('id, producto_id, presentacion, cantidad, unidades, precio_unitario, costo_unitario, es_pola, producto:productos(nombre)').eq('venta_id', v.id),
      cajaAbierta(),
      pagosDe([v]),
      v.comprador_id ? db().from('clientes').select('id, nombre, tipo_documento, numero_documento, dv').eq('id', v.comprador_id).maybeSingle().then((r: any) => r.data) : null,
    ])
    const ve = veUtilidad(req.usuario!.rol)
    const { usuario, utilidad, costo_unitario, ...resto } = v
    const sesion_abierta = !!s && s.id === v.sesion_id
    res.json({
      venta: {
        ...resto, usuario_nombre: usuario?.nombre ?? null, sesion_abierta, comprador: comprador ?? null,
        puede_corregir: sesion_abierta && v.estado === 'activa' && puedeTocar(req.usuario!, v), ...(ve ? { utilidad } : {}),
      },
      items: (items ?? []).map(({ producto, costo_unitario: cu, ...i }: any) => ({ ...i, producto_nombre: producto?.nombre ?? '', ...(ve ? { costo_unitario: cu } : {}) })),
      pagos: pagos.map(({ venta_id, ...p }: any) => p),
    })
  })

  // Anular: solo ventas de la caja abierta (antes del cierre); devuelve las unidades al inventario.
  // Un cajero puede anular (borrar) sus propias ventas, por ejemplo si se registró sin querer.
  app.post('/api/ventas/:id/anular', autenticar, async (req, res) => {
    const motivo = String(req.body?.motivo ?? '').trim()
    if (!motivo) return res.status(400).json({ error: 'Escribe el motivo de la anulación' })
    const { data: v } = await db().from('ventas').select('id, estado, sesion_id, total, usuario_id').eq('id', req.params.id).maybeSingle()
    if (!v) return res.status(404).json({ error: 'Venta no encontrada' })
    if (v.estado === 'anulada') return res.status(409).json({ error: 'La venta ya está anulada' })
    if (!puedeTocar(req.usuario!, v)) return res.status(403).json({ error: 'Solo puedes borrar tus propias ventas' })
    const s = await cajaAbierta()
    if (!s || s.id !== v.sesion_id) return res.status(409).json({ error: 'Solo se pueden anular ventas de la caja abierta (antes del cierre)' })
    const error = await anularVenta(v, req.usuario!.id, motivo)
    if (error) return res.status(500).json({ error: error.message })
    res.json({ ok: true })
  })

  async function anularVenta(v: { id: string; total: number }, usuarioId: string, motivo: string) {
    const { data: items } = await db().from('venta_items').select('producto_id, cantidad, unidades, presentacion').eq('venta_id', v.id)
    const porProducto = new Map<string, number>()
    for (const i of items ?? []) porProducto.set(i.producto_id, (porProducto.get(i.producto_id) ?? 0) + Number(i.unidades ?? i.cantidad))
    for (const [productoId, unidades] of porProducto) {
      const { data: p } = await db().from('productos').select('existencias').eq('id', productoId).maybeSingle()
      if (!p) continue
      await db().from('productos').update({ existencias: Number(p.existencias) + unidades }).eq('id', productoId)
      await registrarMovimiento(productoId, 'ajuste', unidades, usuarioId, `anulación venta ${String(v.id).slice(0, 8)}`)
    }
    // Con control por empaques todo vuelve como se vendió: lo cerrado, cerrado; lo suelto, suelto.
    // (Los empaques que se abrieron para esa venta siguen abiertos: se abrieron de verdad.)
    if (porProducto.size && (await hayEmpaques(db))) {
      const { data: prodsEmp } = await db().from('productos').select('id, nombre').in('id', [...porProducto.keys()]).eq('controla_empaques', true)
      for (const p of prodsEmp ?? []) {
        const { data: presP } = await db().from('presentaciones').select('id, nombre').eq('producto_id', p.id)
        const cerradas: { presentacion_id: string; cantidad: number }[] = []
        let sueltos = 0
        for (const i of (items ?? []).filter((x: any) => x.producto_id === p.id)) {
          const pr = i.presentacion ? presP?.find((x: any) => x.nombre === i.presentacion) : null
          if (pr) cerradas.push({ presentacion_id: pr.id, cantidad: Number(i.cantidad) })
          else sueltos += Number(i.unidades ?? i.cantidad)
        }
        await moverEmpaques(db, p, { cerradas, sueltos })
      }
    }
    const { error } = await db().from('ventas')
      .update({ estado: 'anulada', anulada_por: usuarioId, anulada_en: new Date().toISOString(), motivo_anulacion: motivo }).eq('id', v.id)
    if (error) return error
    await auditar(usuarioId, 'anular_venta', 'ventas', v.id, { total: v.total, motivo })
    return null
  }
}
