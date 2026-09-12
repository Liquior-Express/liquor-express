import type { Express } from 'express'
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
