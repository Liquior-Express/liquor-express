import type { Express } from 'express'
import { autenticar, requiereRol } from '../auth.ts'
import { hoy, r2, recalcularCosto, hayEmpaques } from './comun.ts'
import { moverEmpaques } from './empaques.ts'

// Compras (recepción de mercancía) y proveedores.
// Una compra: suma unidades al inventario, crea lotes con vencimiento, actualiza el
// costo por origen del proveedor (costo promedio del producto) y, si se indica, el precio.

interface Deps {
  db: () => any
  auditar: (usuarioId: string, accion: string, entidad?: string, entidadId?: string, detalle?: unknown) => Promise<void>
  registrarMovimiento: (productoId: string, tipo: 'entrada' | 'venta' | 'merma' | 'ajuste', cantidad: number, usuarioId: string, referencia?: string) => Promise<void>
}

// De la caja del día no sale plata: las compras se pagan con la caja menor, Nequi o Bold, o quedan a crédito.
const FORMAS = ['caja_menor', 'nequi', 'bold', 'credito']
const PAGOS = ['caja_menor', 'nequi', 'bold']
// Sin la actualización 0013 la base rechaza estas formas de pago.
const SIN_0013 = 'Para pagar con caja menor, Nequi o Bold falta aplicar la actualización 0013 de la base de datos'
const pesos = (n: unknown) => '$' + Math.round(Number(n) || 0).toLocaleString('es-CO')
const faltaMigracion = (e: any) => e?.code === '23514' || e?.code === '42703'

export function registrarCompras(app: Express, { db, auditar, registrarMovimiento }: Deps) {
  const gestor = requiereRol('admin', 'gerencia')

  async function cajaMenor() {
    const { data } = await db().from('caja_menor').select('id, saldo').limit(1).maybeSingle()
    return data
  }

  // ── Proveedores ──
  app.get('/api/proveedores', autenticar, gestor, async (_req, res) => {
    const { data, error } = await db().from('proveedores').select('id, nombre, contacto, nit, origen, activo').order('nombre')
    if (error) return res.status(500).json({ error: error.message })
    res.json({ proveedores: data })
  })

  app.post('/api/proveedores', autenticar, gestor, async (req, res) => {
    const nombre = String(req.body?.nombre ?? '').trim()
    if (!nombre) return res.status(400).json({ error: 'El nombre del proveedor es obligatorio' })
    const { data, error } = await db().from('proveedores').insert({
      nombre, contacto: String(req.body?.contacto ?? '').trim() || null, nit: String(req.body?.nit ?? '').trim() || null,
      origen: req.body?.origen === 'brasil' ? 'brasil' : 'colombia',
    }).select('id, nombre, contacto, nit, origen, activo').single()
    if (error) return res.status(500).json({ error: error.message })
    res.status(201).json({ proveedor: data })
  })

  app.patch('/api/proveedores/:id', autenticar, gestor, async (req, res) => {
    const c: Record<string, unknown> = {}
    for (const k of ['nombre', 'contacto', 'nit']) if (req.body?.[k] !== undefined) c[k] = String(req.body[k]).trim() || null
    if (req.body?.origen) c.origen = req.body.origen === 'brasil' ? 'brasil' : 'colombia'
    if (typeof req.body?.activo === 'boolean') c.activo = req.body.activo
    if (Object.keys(c).length === 0) return res.status(400).json({ error: 'Nada que actualizar' })
    const { data, error } = await db().from('proveedores').update(c).eq('id', req.params.id).select('id, nombre, contacto, nit, origen, activo').single()
    if (error) return res.status(500).json({ error: error.message })
    res.json({ proveedor: data })
  })

  // ── Registrar compra ──
  app.post('/api/compras', autenticar, gestor, async (req, res) => {
    const b = req.body ?? {}
    const items: any[] = Array.isArray(b.items) ? b.items : []
    if (!b.proveedor_id) return res.status(400).json({ error: 'Elige el proveedor' })
    if (items.length === 0) return res.status(400).json({ error: 'Agrega al menos un producto' })
    if (!FORMAS.includes(b.forma_pago)) return res.status(400).json({ error: 'Elige cómo se paga: caja menor, Nequi, Bold o a crédito' })
    const forma = b.forma_pago

    const { data: prov } = await db().from('proveedores').select('id, nombre, origen').eq('id', b.proveedor_id).maybeSingle()
    if (!prov) return res.status(400).json({ error: 'Proveedor inválido' })
    const origen = b.origen === 'brasil' || b.origen === 'colombia' ? b.origen : prov.origen
    const moneda = b.moneda === 'BRL' ? 'BRL' : 'COP'
    let tasa: number | null = null
    if (moneda === 'BRL') {
      tasa = Number(b.tasa)
      if (!(tasa > 0)) return res.status(400).json({ error: 'Falta la tasa del Real para convertir la compra' })
    }
    const cv = Math.max(0, Number(b.costos_variables) || 0)

    const ids = [...new Set(items.map((i) => String(i.producto_id)))]
    const emp = await hayEmpaques(db)
    const { data: prods, error: e1 } = await db().from('productos').select('id, nombre, precio_venta, margen_pct' + (emp ? ', controla_empaques' : '')).in('id', ids)
    if (e1) return res.status(500).json({ error: e1.message })
    const presIds = items.map((i) => i.presentacion_id).filter(Boolean)
    const { data: pres } = presIds.length
      ? await db().from('presentaciones').select('id, producto_id, nombre, factor_unidades').in('id', presIds)
      : { data: [] as any[] }

    const lineas: any[] = []
    for (const it of items) {
      const p = prods?.find((x: any) => x.id === it.producto_id)
      if (!p) return res.status(400).json({ error: 'Hay un producto que no existe' })
      const pr = it.presentacion_id ? pres?.find((x: any) => x.id === it.presentacion_id && x.producto_id === p.id) : null
      if (it.presentacion_id && !pr) return res.status(400).json({ error: 'Presentación inválida' })
      const cantidad = Number(it.cantidad)
      const valor = Number(it.valor_unitario)
      if (!(cantidad > 0) || !(valor >= 0)) return res.status(400).json({ error: `Revisa la cantidad y el valor de ${p.nombre}` })
      const factor = pr ? Number(pr.factor_unidades) : 1
      const valorLinea = cantidad * valor
      lineas.push({
        p, pr, cantidad, valor, factor, unidades: cantidad * factor, valorLinea,
        valorLineaCop: moneda === 'BRL' ? valorLinea * (tasa as number) : valorLinea,
        margen: it.margen_pct !== undefined && it.margen_pct !== '' && it.margen_pct !== null ? Number(it.margen_pct) : Number(p.margen_pct) || 0,
        fecha_vencimiento: it.fecha_vencimiento || null,
        precio_nuevo: Number(it.precio_venta) > 0 ? Number(it.precio_venta) : null,
      })
    }

    // Costo final por unidad: valor en pesos + costos variables repartidos según el valor de cada línea.
    const subtotal = lineas.reduce((s, l) => s + l.valorLinea, 0)
    const subtotalCop = lineas.reduce((s, l) => s + l.valorLineaCop, 0)
    for (const l of lineas) {
      const parte = subtotalCop > 0 ? (cv * l.valorLineaCop) / subtotalCop : 0
      l.costoBaseUnd = l.valorLineaCop / l.unidades
      l.varUnd = parte / l.unidades
      l.costoUnd = l.costoBaseUnd + l.varUnd
      l.sugerido = Math.round(l.costoUnd * (1 + l.margen / 100))
    }
    const total = Math.round(subtotalCop + cv)

    // Pago con la caja menor: sale del saldo del fondo.
    const cm = forma === 'caja_menor' ? await cajaMenor() : null
    if (forma === 'caja_menor' && !(Number(cm?.saldo) >= total)) {
      return res.status(409).json({ error: `Saldo de caja menor insuficiente (${pesos(cm?.saldo)})` })
    }

    const { data: compra, error: e2 } = await db().from('compras').insert({
      proveedor_id: prov.id, usuario_id: req.usuario!.id, factura: String(b.factura ?? '').trim() || null,
      fecha: b.fecha || hoy(), origen, moneda, tasa, subtotal: r2(subtotal), costos_variables: cv, total,
      forma_pago: forma, estado_pago: forma === 'credito' ? 'pendiente' : 'pagada',
      pagada_en: forma === 'credito' ? null : new Date().toISOString(),
      pagada_con: forma === 'credito' ? null : forma, notas: String(b.notas ?? '').trim() || null,
    }).select('id, factura').single()
    if (e2) return forma !== 'credito' && faltaMigracion(e2) ? res.status(409).json({ error: SIN_0013 }) : res.status(500).json({ error: e2.message })

    const { error: e3 } = await db().from('compra_items').insert(lineas.map((l) => ({
      compra_id: compra.id, producto_id: l.p.id, presentacion: l.pr ? l.pr.nombre : null, presentacion_id: l.pr?.id ?? null,
      factor_unidades: l.factor, cantidad: l.cantidad, unidades: l.unidades, valor_unitario: l.valor,
      costos_variables: r2(l.varUnd), margen_pct: l.margen, precio_calculado: l.sugerido,
      costo_unitario_cop: r2(l.costoUnd), fecha_vencimiento: l.fecha_vencimiento, precio_nuevo: l.precio_nuevo,
    })))
    if (e3) {
      await db().from('compras').delete().eq('id', compra.id)
      return res.status(500).json({ error: e3.message })
    }

    const ref = `Compra ${compra.factura ? compra.factura + ' · ' : ''}${prov.nombre}`
    if (cm) {
      const { error: e4 } = await db().from('movimientos_caja_menor').insert({ tipo: 'compra', valor: total, compra_id: compra.id, usuario_id: req.usuario!.id, concepto: ref })
      if (e4) {
        await db().from('compra_items').delete().eq('compra_id', compra.id)
        await db().from('compras').delete().eq('id', compra.id)
        return faltaMigracion(e4) ? res.status(409).json({ error: SIN_0013 }) : res.status(500).json({ error: e4.message })
      }
      await db().from('caja_menor').update({ saldo: Number(cm.saldo) - total }).eq('id', cm.id)
    }

    // Inventario, lotes, precio y costo por origen de cada producto.
    for (const l of lineas) {
      const { data: cur } = await db().from('productos').select('existencias, precio_venta').eq('id', l.p.id).single()
      await db().from('productos').update({ existencias: Number(cur.existencias) + l.unidades }).eq('id', l.p.id)
      // Con control por empaques, lo que llega por presentación entra como empaques cerrados.
      if (emp && l.p.controla_empaques) {
        await moverEmpaques(db, l.p, l.pr ? { cerradas: [{ presentacion_id: l.pr.id, cantidad: l.cantidad }] } : { sueltos: l.unidades })
      }
      await registrarMovimiento(l.p.id, 'entrada', l.unidades, req.usuario!.id, ref.slice(0, 60))
      if (l.fecha_vencimiento) {
        await db().from('lotes').insert({ producto_id: l.p.id, cantidad: l.unidades, fecha_vencimiento: l.fecha_vencimiento, costo_lote: r2(l.costoUnd), compra_id: compra.id })
      }
      if (l.precio_nuevo && l.precio_nuevo !== Number(cur.precio_venta)) {
        await db().from('productos').update({ precio_venta: l.precio_nuevo }).eq('id', l.p.id)
        await auditar(req.usuario!.id, 'cambiar_precio', 'productos', l.p.id, { precio_venta: l.precio_nuevo, desde: 'compra' })
      }
      // El costo de este proveedor/origen reemplaza al anterior del mismo proveedor.
      const fila = {
        producto_id: l.p.id, origen, proveedor: prov.nombre, moneda, costo_moneda: r2(l.valor / l.factor), tasa,
        costo_cop: r2(l.costoBaseUnd), costos_variables: r2(l.varUnd), actualizado_en: new Date().toISOString(),
      }
      const { data: previo } = await db().from('costos_origen').select('id')
        .eq('producto_id', l.p.id).eq('origen', origen).eq('proveedor', prov.nombre).limit(1).maybeSingle()
      if (previo) await db().from('costos_origen').update(fila).eq('id', previo.id)
      else await db().from('costos_origen').insert(fila)
      await recalcularCosto(db, l.p.id)
    }

    await auditar(req.usuario!.id, 'registrar_compra', 'compras', compra.id, { proveedor: prov.nombre, factura: compra.factura, total, forma })
    res.status(201).json({ compra: { id: compra.id, total, estado_pago: forma === 'credito' ? 'pendiente' : 'pagada' } })
  })

  // ── Historial y detalle ──
  app.get('/api/compras', autenticar, gestor, async (req, res) => {
    let q = db().from('compras')
      .select('id, fecha, factura, total, subtotal, moneda, tasa, costos_variables, origen, forma_pago, estado_pago, pagada_en, pagada_con, notas, creado_en, proveedor:proveedores(nombre)')
      .order('creado_en', { ascending: false }).limit(150)
    if (req.query.estado === 'pendiente') q = q.eq('estado_pago', 'pendiente')
    const { data, error } = await q
    if (error) return res.status(500).json({ error: error.message })
    res.json({ compras: (data ?? []).map(({ proveedor, ...c }: any) => ({ ...c, proveedor_nombre: proveedor?.nombre ?? null })) })
  })

  app.get('/api/compras/:id', autenticar, gestor, async (req, res) => {
    const { data: c } = await db().from('compras').select('*, proveedor:proveedores(nombre)').eq('id', req.params.id).maybeSingle()
    if (!c) return res.status(404).json({ error: 'Compra no encontrada' })
    const { data: items } = await db().from('compra_items')
      .select('id, presentacion, cantidad, unidades, valor_unitario, costo_unitario_cop, margen_pct, precio_calculado, precio_nuevo, fecha_vencimiento, producto:productos(nombre)')
      .eq('compra_id', c.id)
    const { proveedor, ...resto } = c
    res.json({
      compra: { ...resto, proveedor_nombre: proveedor?.nombre ?? null },
      items: (items ?? []).map(({ producto, ...i }: any) => ({ ...i, producto_nombre: producto?.nombre ?? '' })),
    })
  })

  // ── Pagar una compra a crédito ──
  app.post('/api/compras/:id/pagar', autenticar, gestor, async (req, res) => {
    if (!PAGOS.includes(req.body?.forma)) return res.status(400).json({ error: 'Elige cómo se paga: caja menor, Nequi o Bold' })
    const forma = req.body.forma
    const { data: c } = await db().from('compras').select('id, total, estado_pago, factura, proveedor:proveedores(nombre)').eq('id', req.params.id).maybeSingle()
    if (!c) return res.status(404).json({ error: 'Compra no encontrada' })
    if (c.estado_pago === 'pagada') return res.status(409).json({ error: 'Esta compra ya está pagada' })
    const cm = forma === 'caja_menor' ? await cajaMenor() : null
    if (forma === 'caja_menor' && !(Number(cm?.saldo) >= Number(c.total))) {
      return res.status(409).json({ error: `Saldo de caja menor insuficiente (${pesos(cm?.saldo)})` })
    }
    // Primero se marca pagada: si la base aún no acepta esa forma de pago, no se mueve plata.
    const { error } = await db().from('compras').update({ estado_pago: 'pagada', pagada_en: new Date().toISOString(), pagada_con: forma }).eq('id', c.id)
    if (error) return faltaMigracion(error) ? res.status(409).json({ error: SIN_0013 }) : res.status(500).json({ error: error.message })
    const concepto = `Pago compra ${c.factura ? c.factura + ' · ' : ''}${(c as any).proveedor?.nombre ?? ''}`
    if (cm) {
      const { error: e2 } = await db().from('movimientos_caja_menor').insert({ tipo: 'compra', valor: c.total, compra_id: c.id, usuario_id: req.usuario!.id, concepto })
      if (e2) {
        await db().from('compras').update({ estado_pago: 'pendiente', pagada_en: null, pagada_con: null }).eq('id', c.id)
        return faltaMigracion(e2) ? res.status(409).json({ error: SIN_0013 }) : res.status(500).json({ error: e2.message })
      }
      await db().from('caja_menor').update({ saldo: Number(cm.saldo) - Number(c.total) }).eq('id', cm.id)
    }
    await auditar(req.usuario!.id, 'pagar_compra', 'compras', c.id, { total: c.total, forma })
    res.json({ ok: true })
  })
}
