import type { Express } from 'express'
import PDFDocument from 'pdfkit'
import { autenticar, requiereRol } from '../auth.ts'
import { hoy, primerDiaMes, suma } from './comun.ts'

// Reportes de crecimiento: ventas, utilidad, gastos, ganancia neta, más vendidos, rotación,
// POLA y próximos a vencer. El día de cada venta es la JORNADA de su caja.

interface Deps { db: () => any }

const fechaValida = (s: unknown) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
const sumarDias = (f: string, n: number) => { const d = new Date(f + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const diasEntre = (a: string, b: string) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 864e5) + 1
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null)
const crecimiento = (actual: number, antes: number) => (antes ? Math.round(((actual - antes) / Math.abs(antes)) * 1000) / 10 : null)

export function registrarReportes(app: Express, { db }: Deps) {
  const gestor = requiereRol('admin', 'gerencia')

  // Top 10 más vendidos de los últimos 30 días (atajos en Ventas rápidas; sin costos).
  app.get('/api/top-ventas', autenticar, async (_req, res) => {
    const { data, error } = await db().rpc('rep_productos', { desde: sumarDias(hoy(), -29), hasta: hoy() })
    if (error) return res.status(500).json({ error: error.message })
    const top = (data ?? [])
      .sort((a: any, b: any) => Number(b.unidades) - Number(a.unidades)).slice(0, 10)
      .map((p: any) => ({ producto_id: p.producto_id, nombre: p.nombre, unidades: Number(p.unidades) }))
    res.json({ top })
  })

  // ── Productos por pedir: los que llegaron al mínimo y los que están por llegar ──
  // "Alcanza para" = días que duran las existencias al ritmo de venta de los últimos 30 días.
  async function calcularStock() {
    const [prods, v30] = await Promise.all([
      db().from('productos').select('id, nombre, existencias, stock_min, unidad_base, categoria:categorias(nombre)').eq('activo', true).order('nombre'),
      db().rpc('rep_productos', { desde: sumarDias(hoy(), -29), hasta: hoy() }),
    ])
    if (prods.error) throw new Error(prods.error.message)
    if (v30.error) throw new Error(v30.error.message)
    const vendidas = new Map<string, number>((v30.data ?? []).map((v: any) => [v.producto_id, Number(v.unidades)]))
    const fila = (p: any) => {
      const existencias = Number(p.existencias)
      const stock_min = Number(p.stock_min)
      const vendidas30 = vendidas.get(p.id) ?? 0
      const porDia = vendidas30 / 30
      return {
        id: p.id, nombre: p.nombre, categoria: p.categoria?.nombre ?? '',
        unidad: !p.unidad_base || p.unidad_base === 'unidad' ? 'und' : p.unidad_base,
        existencias, stock_min, faltan: Math.max(0, stock_min - existencias), vendidas30,
        dias_restantes: porDia > 0 ? Math.floor(existencias / porDia) : null,
      }
    }
    // Solo productos activos con alerta configurada (mínimo mayor que cero).
    const conMin = (prods.data ?? []).filter((p: any) => Number(p.stock_min) > 0).map(fila)
    const orden = (a: any, b: any) => (a.existencias - a.stock_min) - (b.existencias - b.stock_min)
    return {
      hoy: hoy(),
      bajos: conMin.filter((p) => p.existencias <= p.stock_min).sort(orden),
      proximos: conMin.filter((p) => p.existencias > p.stock_min && p.existencias <= p.stock_min * 1.5).sort(orden),
    }
  }

  // ── Resumen para la pantalla de Inicio (un solo viaje) ──
  app.get('/api/inicio', autenticar, gestor, async (_req, res) => {
    const h = hoy()
    const desdeMes = primerDiaMes()
    try {
      const [diaHoy, diaMes, gastosMes, stock, lotes, porPagar, cm, sesion, tasa] = await Promise.all([
        db().rpc('rep_ventas_dia', { desde: h, hasta: h }),
        db().rpc('rep_ventas_dia', { desde: desdeMes, hasta: h }),
        db().from('gastos').select('valor').gte('fecha', desdeMes).lte('fecha', h),
        calcularStock(),
        db().from('lotes').select('fecha_vencimiento').gt('cantidad', 0).not('fecha_vencimiento', 'is', null).lte('fecha_vencimiento', sumarDias(h, 30)),
        db().from('compras').select('total').eq('estado_pago', 'pendiente'),
        db().from('caja_menor').select('saldo').limit(1).maybeSingle(),
        db().from('sesiones_caja').select('id, fecha_jornada, apertura').eq('estado', 'abierta').maybeSingle(),
        db().from('tasa_real').select('valor').eq('fecha', h).maybeSingle(),
      ])
      const hoyT = suma(diaHoy.data ?? [], (x) => x.total)
      const mesU = suma(diaMes.data ?? [], (x) => x.utilidad)
      const mesG = suma(gastosMes.data ?? [], (g) => g.valor)
      const vencimientos = lotes.data ?? []

      res.json({
        hoy: { fecha: h, ventas: suma(diaHoy.data ?? [], (x) => x.ventas), total: hoyT, utilidad: suma(diaHoy.data ?? [], (x) => x.utilidad) },
        mes: { desde: desdeMes, total: suma(diaMes.data ?? [], (x) => x.total), utilidad: mesU, gastos: mesG, ganancia_neta: mesU - mesG },
        caja: sesion.data
          ? { abierta: true, fecha_jornada: sesion.data.fecha_jornada, apertura: sesion.data.apertura }
          : { abierta: false },
        tasa: tasa.data ? Number(tasa.data.valor) : null,
        caja_menor: cm.data ? Number(cm.data.saldo) : 0,
        alertas: {
          stock_bajo: stock.bajos.length,
          stock_proximo: stock.proximos.length,
          vencidos: vencimientos.filter((l: any) => l.fecha_vencimiento < h).length,
          por_vencer: vencimientos.filter((l: any) => l.fecha_vencimiento >= h).length,
          por_pagar: { cantidad: (porPagar.data ?? []).length, total: suma(porPagar.data ?? [], (c) => c.total) },
        },
      })
    } catch (e: any) { res.status(500).json({ error: e.message }) }
  })

  app.get('/api/reportes/stock', autenticar, gestor, async (_req, res) => {
    try { res.json(await calcularStock()) } catch (e: any) { res.status(500).json({ error: e.message }) }
  })

  app.get('/api/reportes/stock.pdf', autenticar, gestor, async (_req, res) => {
    let datos
    try { datos = await calcularStock() } catch (e: any) { return res.status(500).json({ error: e.message }) }

    const doc = new PDFDocument({ size: 'LETTER', margin: 48, info: { Title: 'Productos por pedir — Liquor Express' } })
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="productos-por-pedir-${datos.hoy}.pdf"`)
    doc.pipe(res)

    const X = 48
    const ANCHO = 516
    const COLS = [
      { t: 'Producto', w: 168 }, { t: 'Categoría', w: 96 }, { t: 'Existencias', w: 62, d: true },
      { t: 'Mínimo', w: 48, d: true }, { t: 'Faltan', w: 46, d: true }, { t: 'Vend. 30 d', w: 54, d: true }, { t: 'Alcanza', w: 42, d: true },
    ]
    const fechaLarga = new Date(datos.hoy + 'T12:00:00').toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

    doc.fillColor('#111111').font('Helvetica-Bold').fontSize(18).text('Liquor Express', X, 48)
    doc.font('Helvetica').fontSize(11).fillColor('#555555').text('Productos por pedir · ' + fechaLarga)
    let y = 100

    const encabezado = (titulo: string, cuantos: number) => {
      if (y > 640) { doc.addPage(); y = 56 }
      doc.font('Helvetica-Bold').fontSize(12.5).fillColor('#111111').text(`${titulo} (${cuantos})`, X, y)
      y += 20
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#666666')
      let x = X
      for (const c of COLS) { doc.text(c.t.toUpperCase(), x, y, { width: c.w - 6, align: c.d ? 'right' : 'left' }); x += c.w }
      y += 13
      doc.moveTo(X, y).lineTo(X + ANCHO, y).lineWidth(0.8).strokeColor('#bbbbbb').stroke()
      y += 7
    }
    const linea = (f: any) => {
      if (y > 720) {
        doc.addPage(); y = 56
        doc.font('Helvetica-Bold').fontSize(8).fillColor('#666666')
        let xx = X
        for (const c of COLS) { doc.text(c.t.toUpperCase(), xx, y, { width: c.w - 6, align: c.d ? 'right' : 'left' }); xx += c.w }
        y += 13
        doc.moveTo(X, y).lineTo(X + ANCHO, y).lineWidth(0.8).strokeColor('#bbbbbb').stroke()
        y += 7
      }
      const celdas = [
        f.nombre, f.categoria || '—', `${f.existencias} ${f.unidad}`, String(f.stock_min),
        f.faltan > 0 ? String(f.faltan) : '—', String(f.vendidas30), f.dias_restantes === null ? '—' : `${f.dias_restantes} d`,
      ]
      doc.font('Helvetica').fontSize(9.5).fillColor(f.existencias <= 0 ? '#b3261e' : '#111111')
      let x = X
      COLS.forEach((c, i) => { doc.text(celdas[i], x, y, { width: c.w - 6, align: c.d ? 'right' : 'left', lineBreak: false, ellipsis: true }); x += c.w })
      y += 14
      doc.moveTo(X, y).lineTo(X + ANCHO, y).lineWidth(0.4).strokeColor('#e6e6e6').stroke()
      y += 5
    }
    const vacio = (texto: string) => { doc.font('Helvetica-Oblique').fontSize(10).fillColor('#777777').text(texto, X, y); y += 20 }

    encabezado('Ya llegaron al mínimo', datos.bajos.length)
    if (datos.bajos.length) datos.bajos.forEach(linea); else vacio('Ninguno. Todo por encima del mínimo.')
    y += 14
    encabezado('Próximos a llegar al mínimo', datos.proximos.length)
    if (datos.proximos.length) datos.proximos.forEach(linea); else vacio('Ninguno por ahora.')

    y += 18
    doc.font('Helvetica').fontSize(8.5).fillColor('#777777')
      .text('Se listan los productos activos con alerta de stock configurada (mínimo mayor que cero). "Próximos" son los que están hasta un 50% por encima de su mínimo. "Alcanza" estima los días que duran las existencias al ritmo de venta de los últimos 30 días.', X, y, { width: ANCHO })
    doc.fontSize(8).fillColor('#999999').text('Generado por el sistema de Liquor Express · JCA Soft', X, 745, { width: ANCHO, align: 'center' })

    doc.end()
  })

  app.get('/api/reportes', autenticar, gestor, async (req, res) => {
    const desde = fechaValida(req.query.desde) ? String(req.query.desde) : primerDiaMes()
    const hasta = fechaValida(req.query.hasta) ? String(req.query.hasta) : hoy()
    const n = Math.max(1, diasEntre(desde, hasta))
    // Periodo anterior del mismo largo, para comparar el crecimiento.
    const prevHasta = sumarDias(desde, -1)
    const prevDesde = sumarDias(desde, -n)

    const [dias, medios, prods, gastos, diasPrev, gastosPrev, vencer, cierres, inventario] = await Promise.all([
      db().rpc('rep_ventas_dia', { desde, hasta }),
      db().rpc('rep_ventas_medio', { desde, hasta }),
      db().rpc('rep_productos', { desde, hasta }),
      db().from('gastos').select('valor, fecha, categoria').gte('fecha', desde).lte('fecha', hasta),
      db().rpc('rep_ventas_dia', { desde: prevDesde, hasta: prevHasta }),
      db().from('gastos').select('valor').gte('fecha', prevDesde).lte('fecha', prevHasta),
      db().from('lotes').select('cantidad, fecha_vencimiento, producto:productos(nombre, activo)')
        .gt('cantidad', 0).not('fecha_vencimiento', 'is', null).lte('fecha_vencimiento', sumarDias(hoy(), 30)).order('fecha_vencimiento'),
      db().from('sesiones_caja').select('fecha_jornada, apertura, cierre, total_ventas, diferencia, diferencia_reales')
        .eq('estado', 'cerrada').gte('fecha_jornada', desde).lte('fecha_jornada', hasta).order('fecha_jornada'),
      db().from('productos').select('id, nombre, existencias, costo, costos_variables, activo'),
    ])
    for (const r of [dias, medios, prods, gastos, diasPrev, gastosPrev, vencer, cierres, inventario]) {
      if (r.error) return res.status(500).json({ error: r.error.message })
    }

    const d = dias.data ?? []
    const total = suma(d, (x) => x.total)
    const utilidad = suma(d, (x) => x.utilidad)
    const cantidad = suma(d, (x) => x.ventas)
    const totalGastos = suma(gastos.data ?? [], (g) => g.valor)
    const ganancia = utilidad - totalGastos
    const dp = diasPrev.data ?? []
    const totalPrev = suma(dp, (x) => x.total)
    const gananciaPrev = suma(dp, (x) => x.utilidad) - suma(gastosPrev.data ?? [], (g) => g.valor)

    // Serie por jornada: ventas, utilidad bruta, gastos y ganancia neta.
    const mapa = new Map<string, any>()
    for (const x of d) mapa.set(x.fecha, { fecha: x.fecha, ventas: Number(x.ventas), total: Number(x.total), utilidad: Number(x.utilidad), gastos: 0 })
    const gastos_por_categoria: Record<string, number> = {}
    for (const g of gastos.data ?? []) {
      const e = mapa.get(g.fecha) ?? { fecha: g.fecha, ventas: 0, total: 0, utilidad: 0, gastos: 0 }
      e.gastos += Number(g.valor)
      mapa.set(g.fecha, e)
      gastos_por_categoria[g.categoria] = (gastos_por_categoria[g.categoria] ?? 0) + Number(g.valor)
    }
    const serie = [...mapa.values()].sort((a, b) => a.fecha.localeCompare(b.fecha)).map((e) => ({ ...e, ganancia: e.utilidad - e.gastos }))

    // Productos: más vendidos con rotación (días de inventario al ritmo del periodo) y sin movimiento.
    const inv = inventario.data ?? []
    const existenciasDe = new Map<string, number>(inv.map((p: any) => [p.id, Number(p.existencias)]))
    const vendidos = (prods.data ?? []).map((p: any) => ({
      producto_id: p.producto_id, nombre: p.nombre, es_pola: p.es_pola,
      unidades: Number(p.unidades), total: Number(p.total), utilidad: Number(p.total) - Number(p.costo),
    }))
    const mas_vendidos = [...vendidos].sort((a, b) => b.unidades - a.unidades).slice(0, 15).map((p) => {
      const existencias = existenciasDe.get(p.producto_id) ?? 0
      const porDia = p.unidades / n
      return { ...p, existencias, dias_inventario: porDia > 0 ? Math.round(existencias / porDia) : null }
    })
    const vendidosIds = new Set(vendidos.map((p) => p.producto_id))
    const costoUnd = (p: any) => Number(p.costo || 0) + Number(p.costos_variables || 0)
    const conStock = inv.filter((p: any) => p.activo && Number(p.existencias) > 0)
    const sin_movimiento = conStock.filter((p: any) => !vendidosIds.has(p.id))
      .map((p: any) => ({ nombre: p.nombre, existencias: Number(p.existencias), valor: Math.round(Number(p.existencias) * costoUnd(p)) }))
      .sort((a: any, b: any) => b.valor - a.valor).slice(0, 15)

    // POLA: lo vendido de productos surtidos por el bar (para el cuadre con el socio).
    const polaProductos = (prods.data ?? []).filter((p: any) => Number(p.pola_unidades) > 0)
      .map((p: any) => ({ nombre: p.nombre, unidades: Number(p.pola_unidades), total: Number(p.pola_total) }))
      .sort((a: any, b: any) => b.total - a.total)

    // Próximos a vencer (30 días) y ya vencidos con unidades.
    const h = hoy()
    const por_vencer = (vencer.data ?? []).filter((l: any) => l.producto?.activo !== false).map((l: any) => ({
      nombre: l.producto?.nombre ?? '', cantidad: Number(l.cantidad), fecha: l.fecha_vencimiento, dias: diasEntre(h, l.fecha_vencimiento) - 1,
    }))

    res.json({
      desde, hasta, dias: n,
      resumen: {
        ventas: cantidad, total, costo: total - utilidad, utilidad, gastos: totalGastos, ganancia_neta: ganancia,
        margen_bruto: pct(utilidad, total), relacion_gastos: pct(totalGastos, total),
        ticket_promedio: cantidad ? Math.round(total / cantidad) : 0, promedio_diario: Math.round(total / n),
        valor_inventario: Math.round(suma(conStock, (p) => Number(p.existencias) * costoUnd(p))),
      },
      comparacion: {
        desde: prevDesde, hasta: prevHasta, total: totalPrev, ganancia_neta: gananciaPrev,
        crecimiento_ventas: crecimiento(total, totalPrev), crecimiento_ganancia: crecimiento(ganancia, gananciaPrev),
      },
      serie,
      por_medio: (medios.data ?? []).map((m: any) => ({ medio: m.medio, ventas: Number(m.ventas), total: Number(m.total), reales: Number(m.reales) })),
      gastos_por_categoria, mas_vendidos, sin_movimiento,
      pola: { productos: polaProductos, unidades: suma(polaProductos, (p) => p.unidades), total: suma(polaProductos, (p) => p.total) },
      por_vencer,
      cierres: cierres.data ?? [],
    })
  })
}
