import type { Express } from 'express'
import { autenticar, requiereRol, veUtilidad } from '../auth.ts'
import { hoy, r2, a50, suma, inicioDia, finDia, descontarLotes } from './comun.ts'

// Ventas rápidas, historial/anulación y Caja (apertura, entradas/salidas, cierre en pesos y reales).
// Terminal único: solo hay una caja abierta a la vez y toda venta pertenece a ella.

interface Deps {
  db: () => any
  auditar: (usuarioId: string, accion: string, entidad?: string, entidadId?: string, detalle?: unknown) => Promise<void>
  registrarMovimiento: (productoId: string, tipo: 'entrada' | 'venta' | 'merma' | 'ajuste', cantidad: number, usuarioId: string, referencia?: string) => Promise<void>
}

const MEDIOS = ['efectivo', 'nequi', 'bold', 'pix']
const fechaValida = (s: unknown) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
const COLS_VENTA = 'id, total, medio_pago, valor_reales, tasa_real, moneda_efectivo, cambio, cambio_en, creado_en'

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

  // Resumen de una sesión: ventas activas por medio y efectivo esperado en pesos y en reales.
  async function resumenSesion(s: any) {
    const [{ data: ventas }, { data: movs }] = await Promise.all([
      db().from('ventas').select('id, total, utilidad, medio_pago, valor_reales, moneda_efectivo, efectivo_recibido, cambio, cambio_en')
        .eq('sesion_id', s.id).eq('estado', 'activa'),
      db().from('movimientos_caja').select('id, tipo, concepto, valor, creado_en').eq('sesion_id', s.id).order('creado_en'),
    ])
    const v = ventas ?? []
    const m = movs ?? []
    const efCop = v.filter((x: any) => x.medio_pago === 'efectivo' && x.moneda_efectivo !== 'BRL')
    const efBrl = v.filter((x: any) => x.medio_pago === 'efectivo' && x.moneda_efectivo === 'BRL')
    const pix = v.filter((x: any) => x.medio_pago === 'pix')
    const ingresos = suma(m.filter((x: any) => x.tipo === 'ingreso'), (x) => x.valor)
    const egresos = suma(m.filter((x: any) => x.tipo === 'egreso'), (x) => x.valor)
    // Pago en reales con cambio en pesos: entran los reales recibidos y salen pesos del cajón.
    const cambioPesosDeReales = suma(efBrl.filter((x: any) => x.cambio_en === 'COP'), (x) => x.cambio)
    const realesQueEntraron = suma(efBrl, (x) => (x.cambio_en === 'COP' && x.efectivo_recibido ? x.efectivo_recibido : x.valor_reales))

    return {
      ventas: { cantidad: v.length, total: suma(v, (x) => x.total), utilidad: suma(v, (x) => x.utilidad) },
      por_medio: {
        efectivo: suma(efCop, (x) => x.total),
        efectivo_reales: { pesos: suma(efBrl, (x) => x.total), reales: r2(suma(efBrl, (x) => x.valor_reales)) },
        nequi: suma(v.filter((x: any) => x.medio_pago === 'nequi'), (x) => x.total),
        bold: suma(v.filter((x: any) => x.medio_pago === 'bold'), (x) => x.total),
        pix: { pesos: suma(pix, (x) => x.total), reales: r2(suma(pix, (x) => x.valor_reales)) },
      },
      ingresos, egresos, movimientos: m,
      esperado_efectivo: Math.round(Number(s.base_apertura) + suma(efCop, (x) => x.total) - cambioPesosDeReales + ingresos - egresos),
      esperado_reales: r2(Number(s.base_reales) + realesQueEntraron),
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
      sesion: { id: s.id, apertura: s.apertura, base_apertura: Number(s.base_apertura), base_reales: Number(s.base_reales), abierta_por: u?.nombre ?? null },
      resumen: sinUtilidad(r, veUtilidad(req.usuario!.rol)),
    })
  })

  app.post('/api/caja/abrir', autenticar, async (req, res) => {
    if (await cajaAbierta()) return res.status(409).json({ error: 'Ya hay una caja abierta' })
    const base = Number(req.body?.base) || 0
    const base_reales = Number(req.body?.base_reales) || 0
    if (base < 0 || base_reales < 0) return res.status(400).json({ error: 'La base no puede ser negativa' })
    const { data, error } = await db().from('sesiones_caja')
      .insert({ usuario_id: req.usuario!.id, base_apertura: base, base_reales, estado: 'abierta' }).select('id').single()
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
    const valor = Number(req.body?.valor)
    const concepto = String(req.body?.concepto ?? '').trim()
    if (!['ingreso', 'egreso'].includes(tipo) || !(valor > 0) || !concepto) {
      return res.status(400).json({ error: 'Tipo, concepto y valor son obligatorios' })
    }
    const { error } = await db().from('movimientos_caja').insert({ sesion_id: s.id, tipo, concepto, valor, usuario_id: req.usuario!.id })
    if (error) return res.status(500).json({ error: error.message })
    await auditar(req.usuario!.id, 'movimiento_caja', 'sesiones_caja', s.id, { tipo, concepto, valor })
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
    await auditar(req.usuario!.id, 'cerrar_caja', 'sesiones_caja', s.id, {
      esperado: r.esperado_efectivo, contado, diferencia: cierre.diferencia, diferencia_reales: cierre.diferencia_reales,
    })
    res.json({ cierre: { ...cierre, apertura: s.apertura, base_apertura: Number(s.base_apertura), base_reales: Number(s.base_reales), resumen: sinUtilidad(r, veUtilidad(req.usuario!.rol)) } })
  })

  app.get('/api/caja/historial', autenticar, gestor, async (_req, res) => {
    const { data, error } = await db().from('sesiones_caja')
      .select('id, apertura, cierre, base_apertura, total_ventas, total_efectivo, total_nequi, total_bold, total_pix, esperado_caja, contado_efectivo, diferencia, esperado_reales, contado_reales, diferencia_reales, observaciones')
      .eq('estado', 'cerrada').order('cierre', { ascending: false }).limit(30)
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
    if (!MEDIOS.includes(medio)) return res.status(400).json({ error: 'Medio de pago inválido' })

    const sesion = await cajaAbierta()
    if (!sesion) return res.status(409).json({ error: 'La caja está cerrada. Ábrela en el módulo Caja para vender.' })

    const ids = [...new Set(items.map((i) => String(i.producto_id)))]
    const { data: prods, error: e1 } = await db().from('productos')
      .select('id, nombre, precio_venta, costo, costos_variables, existencias, es_pola, activo, controla_vencimiento').in('id', ids)
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

    // Pago: PIX y efectivo en reales usan la tasa de hoy; el efectivo guarda recibido y cambio.
    let tasa: number | null = null
    let valor_reales: number | null = null
    let moneda_efectivo: string | null = null
    let efectivo_recibido: number | null = null
    let cambio: number | null = null
    let cambio_en: string | null = null
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
      cliente_id, vendida_en,
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
    if (e3) {
      await db().from('ventas').delete().eq('id', venta.id)
      return res.status(500).json({ error: e3.message })
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
    res.status(201).json({ venta, avisos })
  })

  app.get('/api/ventas/hoy', autenticar, async (req, res) => {
    const { data, error } = await db().from('ventas')
      .select('id, total, utilidad, medio_pago, valor_reales, creado_en').eq('estado', 'activa')
      .gte('creado_en', inicioDia(hoy())).order('creado_en', { ascending: false })
    if (error) return res.status(500).json({ error: error.message })
    const ve = veUtilidad(req.usuario!.rol)
    const lista = data ?? []
    const por_medio: Record<string, number> = {}
    for (const v of lista) por_medio[v.medio_pago] = (por_medio[v.medio_pago] ?? 0) + Number(v.total)
    res.json({
      ventas: lista.slice(0, 20).map((v: any) => { if (ve) return v; const { utilidad, ...r } = v; return r }),
      resumen: {
        cantidad: lista.length,
        total: suma(lista, (v) => v.total),
        por_medio,
        ...(ve ? { utilidad: suma(lista, (v) => v.utilidad) } : {}),
      },
    })
  })

  // ── Historial de ventas ──
  app.get('/api/ventas', autenticar, async (req, res) => {
    const desde = fechaValida(req.query.desde) ? String(req.query.desde) : hoy()
    const hasta = fechaValida(req.query.hasta) ? String(req.query.hasta) : hoy()
    let q = db().from('ventas')
      .select('id, total, utilidad, medio_pago, valor_reales, moneda_efectivo, estado, creado_en, vendida_en, usuario:usuarios!ventas_usuario_id_fkey(nombre)')
      .gte('creado_en', inicioDia(desde)).lte('creado_en', finDia(hasta))
      .order('creado_en', { ascending: false }).limit(300)
    if (MEDIOS.includes(String(req.query.medio))) q = q.eq('medio_pago', req.query.medio)
    if (req.query.estado === 'activa' || req.query.estado === 'anulada') q = q.eq('estado', req.query.estado)
    const { data, error } = await q
    if (error) return res.status(500).json({ error: error.message })

    const ve = veUtilidad(req.usuario!.rol)
    const lista = (data ?? []).map(({ usuario, utilidad, ...v }: any) => ({ ...v, usuario_nombre: usuario?.nombre ?? null, ...(ve ? { utilidad } : {}) }))
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
    const [{ data: items }, s] = await Promise.all([
      db().from('venta_items').select('id, presentacion, cantidad, unidades, precio_unitario, costo_unitario, es_pola, producto:productos(nombre)').eq('venta_id', v.id),
      cajaAbierta(),
    ])
    const ve = veUtilidad(req.usuario!.rol)
    const { usuario, utilidad, costo_unitario, ...resto } = v
    res.json({
      venta: { ...resto, usuario_nombre: usuario?.nombre ?? null, sesion_abierta: !!s && s.id === v.sesion_id, ...(ve ? { utilidad } : {}) },
      items: (items ?? []).map(({ producto, costo_unitario: cu, ...i }: any) => ({ ...i, producto_nombre: producto?.nombre ?? '', ...(ve ? { costo_unitario: cu } : {}) })),
    })
  })

  // Anular: solo ventas de la caja abierta (antes del cierre); devuelve las unidades al inventario.
  app.post('/api/ventas/:id/anular', autenticar, gestor, async (req, res) => {
    const motivo = String(req.body?.motivo ?? '').trim()
    if (!motivo) return res.status(400).json({ error: 'Escribe el motivo de la anulación' })
    const { data: v } = await db().from('ventas').select('id, estado, sesion_id, total').eq('id', req.params.id).maybeSingle()
    if (!v) return res.status(404).json({ error: 'Venta no encontrada' })
    if (v.estado === 'anulada') return res.status(409).json({ error: 'La venta ya está anulada' })
    const s = await cajaAbierta()
    if (!s || s.id !== v.sesion_id) return res.status(409).json({ error: 'Solo se pueden anular ventas de la caja abierta (antes del cierre)' })

    const { data: items } = await db().from('venta_items').select('producto_id, cantidad, unidades').eq('venta_id', v.id)
    const porProducto = new Map<string, number>()
    for (const i of items ?? []) porProducto.set(i.producto_id, (porProducto.get(i.producto_id) ?? 0) + Number(i.unidades ?? i.cantidad))
    for (const [productoId, unidades] of porProducto) {
      const { data: p } = await db().from('productos').select('existencias').eq('id', productoId).maybeSingle()
      if (!p) continue
      await db().from('productos').update({ existencias: Number(p.existencias) + unidades }).eq('id', productoId)
      await registrarMovimiento(productoId, 'ajuste', unidades, req.usuario!.id, `anulación venta ${String(v.id).slice(0, 8)}`)
    }
    const { error } = await db().from('ventas')
      .update({ estado: 'anulada', anulada_por: req.usuario!.id, anulada_en: new Date().toISOString(), motivo_anulacion: motivo }).eq('id', v.id)
    if (error) return res.status(500).json({ error: error.message })
    await auditar(req.usuario!.id, 'anular_venta', 'ventas', v.id, { total: v.total, motivo })
    res.json({ ok: true })
  })
}
