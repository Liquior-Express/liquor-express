/**
 * Semilla de demostración — Liquor Express (JCA Soft · Kaizen)
 *
 *   node apps/api/herramientas/semilla.mjs
 *
 * Crea catálogo, compras, jornadas de caja con ventas, gastos y caja menor
 * para poder probar reportes y visualización con datos parecidos a la realidad
 * del negocio. Guarda TODO lo que crea en `.semilla.json`, de modo que
 * `limpiar-semilla.mjs` pueda borrarlo después sin tocar los datos reales.
 */
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { writeFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const AQUI = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(AQUI, '../.env') })
const REGISTRO = resolve(AQUI, '.semilla.json')

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

if (existsSync(REGISTRO) && !process.argv.includes('--forzar')) {
  console.error('Ya hay una semilla sembrada (.semilla.json). Ejecute limpiar-semilla.mjs primero, o use --forzar.')
  process.exit(1)
}

// ── Utilidades ──────────────────────────────────────────────────────────────
const creado = {
  categorias: [], productos: [], presentaciones: [], proveedores: [], compras: [],
  compra_items: [], lotes: [], sesiones_caja: [], ventas: [], venta_items: [],
  movimientos_inventario: [], movimientos_caja: [], gastos: [],
  movimientos_caja_menor: [], mermas: [], costos_origen: [], tasa_real: [],
}
// El registro se guarda en cada inserción: si algo falla a mitad de camino,
// `limpiar-semilla.mjs` igual sabe qué borrar y no quedan datos sueltos.
const guardarRegistro = () => writeFileSync(REGISTRO, JSON.stringify({ sembrado_en: new Date().toISOString(), ...creado }, null, 1))

const insertar = async (tabla, filas) => {
  if (!filas.length) return []
  const { data, error } = await db.from(tabla).insert(filas).select()
  if (error) throw new Error(tabla + ': ' + error.message)
  for (const f of data) creado[tabla].push(f.id ?? f.fecha)
  guardarRegistro()
  return data
}

// Azar reproducible: la misma semilla produce siempre los mismos datos.
let _s = 20260914
const azar = () => { _s = (_s * 1103515245 + 12345) % 2147483648; return _s / 2147483648 }
const entre = (a, b) => a + Math.floor(azar() * (b - a + 1))
const elegir = (lista) => lista[Math.floor(azar() * lista.length)]
const r50 = (n) => Math.round(n / 50) * 50

const HOY = new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 10)
const dia = (base, n) => { const d = new Date(base + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
// Hora local de Leticia (UTC-5) para que cada venta caiga en la jornada correcta.
const enHora = (fecha, hh, mm = 0) => fecha + 'T' + String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0') + ':00-05:00'

console.log('Sembrando datos de demostración…\n')

// ── 1 · Categorías ──────────────────────────────────────────────────────────
const catsExistentes = (await db.from('categorias').select('id,nombre')).data ?? []
const porNombre = new Map(catsExistentes.map((c) => [c.nombre.toLowerCase(), c.id]))
const NUEVAS_CATS = ['Cervezas', 'Licores', 'Gaseosas y aguas', 'Cigarrillos']
const catsNuevas = await insertar('categorias', NUEVAS_CATS.filter((n) => !porNombre.has(n.toLowerCase())).map((nombre) => ({ nombre })))
for (const c of catsNuevas) porNombre.set(c.nombre.toLowerCase(), c.id)
const cat = (n) => porNombre.get(n.toLowerCase()) ?? null
console.log('  categorías nuevas: ' + catsNuevas.length)

// ── 2 · Productos ───────────────────────────────────────────────────────────
// costo + costos variables + margen → precio de venta (igual que lo calcula la app).
const CATALOGO = [
  { k: 'aguila', nombre: 'Cerveza Águila 330ml', categoria: 'Cervezas', costo: 2200, cv: 120, precio: 3000, inicial: 360, min: 60, pola: true, cod: '7702004003508' },
  { k: 'poker', nombre: 'Cerveza Poker 330ml', categoria: 'Cervezas', costo: 2200, cv: 120, precio: 3000, inicial: 300, min: 60, pola: true, cod: '7702004001504' },
  { k: 'club', nombre: 'Cerveza Club Colombia Dorada', categoria: 'Cervezas', costo: 3100, cv: 150, precio: 4200, inicial: 144, min: 24, pola: true, cod: '7702004006509' },
  { k: 'brahma', nombre: 'Cerveza Brahma 350ml', categoria: 'Cervezas', costo: 2400, cv: 260, precio: 3500, inicial: 120, min: 24, pola: true, cod: '7891991000512' },
  { k: 'aguardiente', nombre: 'Aguardiente Antioqueño 750ml', categoria: 'Licores', costo: 38000, cv: 900, precio: 52000, inicial: 24, min: 6, cod: '7702049000109' },
  { k: 'ron', nombre: 'Ron Medellín 8 años 750ml', categoria: 'Licores', costo: 52000, cv: 1000, precio: 69000, inicial: 18, min: 4, cod: '7702049001106' },
  { k: 'whisky', nombre: 'Whisky Old Parr 750ml', categoria: 'Licores', costo: 145000, cv: 2000, precio: 189000, inicial: 8, min: 2, cod: '5000281005102' },
  { k: 'cachaca', nombre: 'Cachaça 51 · 965ml', categoria: 'Licores', costo: 27000, cv: 2500, precio: 39000, inicial: 12, min: 3, cod: '7891121000108' },
  { k: 'coca', nombre: 'Coca-Cola 400ml', categoria: 'Gaseosas y aguas', costo: 1750, cv: 90, precio: 2500, inicial: 240, min: 48, cod: '7702084002101' },
  { k: 'agua', nombre: 'Agua Cristal 600ml', categoria: 'Gaseosas y aguas', costo: 1150, cv: 70, precio: 2000, inicial: 216, min: 48, cod: '7702084003009' },
  { k: 'hit', nombre: 'Jugo Hit Tropical 250ml', categoria: 'Gaseosas y aguas', costo: 1400, cv: 80, precio: 2200, inicial: 72, min: 24, cod: '7702084005102', vence: -4 },
  { k: 'chocoramo', nombre: 'Chocoramo tajado', categoria: 'Confiteria', costo: 1750, cv: 90, precio: 2500, inicial: 96, min: 24, cod: '7702025100109', vence: 16 },
  { k: 'marlboro', nombre: 'Marlboro (cigarrillo)', categoria: 'Cigarrillos', costo: 480, cv: 20, precio: 700, inicial: 800, min: 200, cod: '7702027000116' },
  { k: 'lucky', nombre: 'Lucky Strike (cigarrillo)', categoria: 'Cigarrillos', costo: 440, cv: 20, precio: 650, inicial: 600, min: 200, cod: '7702027000505' },
]

const margenDe = (costo, cv, precio) => Math.round(((precio / (costo + cv)) - 1) * 10000) / 100

const productos = await insertar('productos', CATALOGO.map((p) => ({
  nombre: p.nombre,
  categoria_id: cat(p.categoria),
  unidad_base: 'unidad',
  costo: p.costo,
  costos_variables: p.cv,
  margen_pct: margenDe(p.costo, p.cv, p.precio),
  precio_venta: p.precio,
  existencias: p.inicial,
  stock_min: p.min,
  es_pola: !!p.pola,
  controla_vencimiento: p.vence !== undefined,
  codigo_barras: p.cod,
  activo: true,
})))
const P = {}
CATALOGO.forEach((c, i) => { P[c.k] = { ...productos[i], k: c.k, def: c } })
console.log('  productos: ' + productos.length)

// Entrada inicial en el kardex (como cuando se da de alta un producto).
await insertar('movimientos_inventario', CATALOGO.map((c, i) => ({
  producto_id: productos[i].id, tipo: 'entrada', cantidad: c.inicial,
  referencia: 'alta de producto', creado_en: enHora(dia(HOY, -46), 9, 10 + i),
})))

// Presentaciones: cervezas por six y caja; cigarrillos por cajetilla y cartón.
await insertar('presentaciones', [
  { producto_id: P.aguila.id, nombre: 'Six pack', factor_unidades: 6, precio: 17000 },
  { producto_id: P.aguila.id, nombre: 'Caja', factor_unidades: 30, precio: 82000 },
  { producto_id: P.poker.id, nombre: 'Six pack', factor_unidades: 6, precio: 17000 },
  { producto_id: P.poker.id, nombre: 'Caja', factor_unidades: 30, precio: 82000 },
  { producto_id: P.club.id, nombre: 'Six pack', factor_unidades: 6, precio: 24000 },
  { producto_id: P.brahma.id, nombre: 'Six pack', factor_unidades: 6, precio: 20000 },
  { producto_id: P.marlboro.id, nombre: 'Cajetilla', factor_unidades: 20, precio: 13000 },
  { producto_id: P.marlboro.id, nombre: 'Cartón', factor_unidades: 200, precio: 125000 },
  { producto_id: P.lucky.id, nombre: 'Cajetilla', factor_unidades: 20, precio: 12000 },
])
console.log('  presentaciones: 9')

// Lotes con vencimiento (uno vencido y uno por vencer) para ver las alertas.
await insertar('lotes', [
  { producto_id: P.hit.id, cantidad: 24, fecha_vencimiento: dia(HOY, -4), costo_lote: P.hit.def.costo },
  { producto_id: P.chocoramo.id, cantidad: 48, fecha_vencimiento: dia(HOY, 16), costo_lote: P.chocoramo.def.costo },
])

// Costo por origen de lo que llega de Brasil (se paga en Reales).
await insertar('costos_origen', [
  { producto_id: P.brahma.id, origen: 'brasil', proveedor: 'Distribuidora Tabatinga', moneda: 'BRL', costo_moneda: 3.8, tasa: 660, costo_cop: 2508, costos_variables: 260 },
  { producto_id: P.cachaca.id, origen: 'brasil', proveedor: 'Distribuidora Tabatinga', moneda: 'BRL', costo_moneda: 41, tasa: 660, costo_cop: 27060, costos_variables: 2500 },
])

// ── 3 · Proveedores y compras ───────────────────────────────────────────────
const [provCo, provBr] = await insertar('proveedores', [
  { nombre: 'Bavaria · Distribuidora Amazonas', contacto: '311 555 0142', nit: '860005224-6', origen: 'colombia', activo: true },
  { nombre: 'Distribuidora Tabatinga', contacto: '+55 97 98111 2020', origen: 'brasil', activo: true },
])

const compras = []
const compraDe = async ({ prov, fecha, factura, origen, moneda, tasa, items, forma_pago, estado_pago, cv }) => {
  const subtotal = items.reduce((s, i) => s + i.unidades * i.costoCop, 0)
  const [c] = await insertar('compras', [{
    proveedor_id: prov, factura, fecha, origen, moneda, tasa,
    subtotal, costos_variables: cv, total: subtotal + cv,
    forma_pago, estado_pago,
    pagada_en: estado_pago === 'pagada' ? enHora(fecha, 10) : null,
    pagada_con: estado_pago === 'pagada' ? (forma_pago === 'efectivo_caja' ? 'efectivo_caja' : 'transferencia') : null,
    creado_en: enHora(fecha, 10),
  }])
  await insertar('compra_items', items.map((i) => ({
    compra_id: c.id, producto_id: i.p.id, presentacion: i.presentacion ?? null,
    cantidad: i.cantidad, factor_unidades: i.factor ?? 1, unidades: i.unidades,
    valor_unitario: i.valorUnitario, costo_unitario_cop: i.costoCop,
    costos_variables: 0, margen_pct: i.p.margen_pct, precio_calculado: i.p.precio_venta,
  })))
  await insertar('movimientos_inventario', items.map((i) => ({
    producto_id: i.p.id, tipo: 'entrada', cantidad: i.unidades,
    referencia: 'compra ' + factura, creado_en: enHora(fecha, 10, 5),
  })))
  compras.push({ id: c.id, fecha, items })
  return c
}

await compraDe({
  prov: provCo.id, fecha: dia(HOY, -21), factura: 'FV-20481', origen: 'colombia', moneda: 'COP', tasa: null,
  forma_pago: 'transferencia', estado_pago: 'pagada', cv: 120000,
  items: [
    { p: P.aguila, presentacion: 'Caja', cantidad: 6, factor: 30, unidades: 180, valorUnitario: 66000, costoCop: 2200 },
    { p: P.poker, presentacion: 'Caja', cantidad: 4, factor: 30, unidades: 120, valorUnitario: 66000, costoCop: 2200 },
    { p: P.coca, presentacion: null, cantidad: 120, unidades: 120, valorUnitario: 1750, costoCop: 1750 },
  ],
})
await compraDe({
  prov: provBr.id, fecha: dia(HOY, -9), factura: 'NF-7734', origen: 'brasil', moneda: 'BRL', tasa: 660,
  forma_pago: 'credito', estado_pago: 'pendiente', cv: 180000,
  items: [
    { p: P.brahma, presentacion: 'Six pack', cantidad: 10, factor: 6, unidades: 60, valorUnitario: 22.8, costoCop: 2508 },
    { p: P.cachaca, presentacion: null, cantidad: 6, unidades: 6, valorUnitario: 41, costoCop: 27060 },
  ],
})
console.log('  compras: 2 (una a crédito, queda en «por pagar»)')

// ── 4 · Tasa del Real ───────────────────────────────────────────────────────
const tasas = []
for (let i = 20; i >= 2; i -= 2) tasas.push({ fecha: dia(HOY, -i), valor: 640 + entre(0, 5) * 5 })
tasas.push({ fecha: HOY, valor: 665 })
for (const t of tasas) {
  const { error } = await db.from('tasa_real').upsert(t)
  if (!error) creado.tasa_real.push(t.fecha)
}
guardarRegistro()
console.log('  tasa del Real: ' + tasas.length + ' días')

// ── 5 · Jornadas de caja con ventas ─────────────────────────────────────────
// El peso define qué tanto se mueve cada producto (y por lo tanto el Top 10).
const PESOS = [
  [P.aguila, 22], [P.poker, 17], [P.coca, 14], [P.agua, 11], [P.marlboro, 9],
  [P.chocoramo, 8], [P.club, 7], [P.brahma, 6], [P.lucky, 5], [P.hit, 4],
  [P.aguardiente, 3], [P.cachaca, 2], [P.ron, 1], [P.whisky, 1],
]
const RULETA = PESOS.flatMap(([p, n]) => Array(n).fill(p))
const MEDIOS = [...Array(12).fill('efectivo'), ...Array(4).fill('nequi'), ...Array(2).fill('bold'), 'pix', 'pix']
const tasaDe = (f) => (tasas.filter((t) => t.fecha <= f).pop() ?? { valor: 660 }).valor

const JORNADAS = [-40, -37, -33, -30, -26, -23, -19, -16, -12, -9, -6, -3, -1].map((n) => dia(HOY, n))
const consumo = new Map()
let totalVentas = 0

for (const fecha of JORNADAS) {
  const base = 100000
  // Nace cerrada: son jornadas pasadas y, además, la base solo admite una caja
  // abierta a la vez (la que el negocio tenga abierta no se toca).
  const [sesion] = await insertar('sesiones_caja', [{
    base_apertura: base, base_reales: 0, fecha_jornada: fecha,
    apertura: enHora(fecha, 11, 30), estado: 'cerrada',
  }])

  const cuantas = entre(4, 7)
  let efectivo = 0, nequi = 0, bold = 0, pix = 0, ventasTotal = 0
  for (let v = 0; v < cuantas; v++) {
    const hora = 12 + Math.floor((v / cuantas) * 10)
    const cuando = enHora(fecha, hora, entre(0, 59))
    const medio = elegir(MEDIOS)
    const lineas = []
    const cuantosItems = entre(1, 3)
    for (let i = 0; i < cuantosItems; i++) {
      const p = elegir(RULETA)
      if (lineas.some((l) => l.p.id === p.id)) continue
      // A veces se vende por presentación (six de cerveza, cajetilla de cigarrillos).
      const porSix = ['aguila', 'poker', 'club', 'brahma'].includes(p.k) && azar() < 0.25
      const porCajetilla = ['marlboro', 'lucky'].includes(p.k) && azar() < 0.7
      if (porSix) lineas.push({ p, presentacion: 'Six pack', cantidad: entre(1, 2), factor: 6, precio: p.k === 'club' ? 24000 : p.k === 'brahma' ? 20000 : 17000 })
      else if (porCajetilla) lineas.push({ p, presentacion: 'Cajetilla', cantidad: 1, factor: 20, precio: p.k === 'marlboro' ? 13000 : 12000 })
      else lineas.push({ p, presentacion: null, cantidad: entre(1, 4), factor: 1, precio: Number(p.precio_venta) })
    }
    if (!lineas.length) continue

    const subtotal = lineas.reduce((s, l) => s + l.precio * l.cantidad, 0)
    const utilidad = lineas.reduce((s, l) => s + (l.precio - Number(l.p.costo) * l.factor) * l.cantidad, 0)
    const tasa = tasaDe(fecha)
    const esEfectivo = medio === 'efectivo'
    const recibido = esEfectivo ? Math.max(subtotal, r50(subtotal * 1.15 + 1000)) : null

    const [venta] = await insertar('ventas', [{
      sesion_id: sesion.id, subtotal, utilidad, total: subtotal,
      medio_pago: medio, estado: 'activa',
      valor_reales: medio === 'pix' ? Math.round((subtotal / tasa) * 100) / 100 : null,
      tasa_real: medio === 'pix' ? tasa : null,
      moneda_efectivo: esEfectivo ? 'COP' : null,
      efectivo_recibido: recibido,
      cambio: esEfectivo ? recibido - subtotal : null,
      cambio_en: esEfectivo ? 'COP' : null,
      vendida_en: cuando, creado_en: cuando,
    }])

    await insertar('venta_items', lineas.map((l) => ({
      venta_id: venta.id, producto_id: l.p.id, presentacion: l.presentacion,
      cantidad: l.cantidad, unidades: l.cantidad * l.factor,
      precio_unitario: l.precio, costo_unitario: Number(l.p.costo) * l.factor,
      es_pola: !!l.p.def.pola,
    })))
    await insertar('movimientos_inventario', lineas.map((l) => ({
      producto_id: l.p.id, tipo: 'venta', cantidad: -(l.cantidad * l.factor),
      referencia: venta.id, creado_en: cuando,
    })))
    for (const l of lineas) consumo.set(l.p.id, (consumo.get(l.p.id) ?? 0) + l.cantidad * l.factor)

    ventasTotal += subtotal
    if (medio === 'efectivo') efectivo += subtotal
    else if (medio === 'nequi') nequi += subtotal
    else if (medio === 'bold') bold += subtotal
    else pix += subtotal
    totalVentas++
  }

  // De vez en cuando sale plata de la caja que no es gasto (los gastos van en la tabla de gastos).
  let ingresos = 0, egresos = 0
  if (azar() < 0.35) {
    const valor = 50000
    await insertar('movimientos_caja', [{ sesion_id: sesion.id, tipo: 'egreso', concepto: 'Retiro de los socios', valor, creado_en: enHora(fecha, 16) }])
    egresos += valor
  }

  const esperado = base + efectivo + ingresos - egresos
  // El cuadre casi siempre da; de vez en cuando sobra o falta algo suelto.
  const contado = azar() < 0.75 ? esperado : esperado + elegir([-2000, -1000, 1000, 2000])
  const { error } = await db.from('sesiones_caja').update({
    estado: 'cerrada', cierre: enHora(fecha, 22, 15),
    total_ventas: ventasTotal, total_efectivo: efectivo, total_nequi: nequi, total_bold: bold, total_pix: pix,
    total_ingresos: ingresos, total_egresos: egresos,
    esperado_caja: esperado, esperado_reales: 0,
    contado_efectivo: contado, contado_reales: 0,
    diferencia: contado - esperado, diferencia_reales: 0,
    tasa_real: tasaDe(fecha),
  }).eq('id', sesion.id)
  if (error) throw new Error('cierre de caja: ' + error.message)
}
console.log('  jornadas de caja: ' + JORNADAS.length + ' · ventas: ' + totalVentas)

// ── 6 · Mermas ──────────────────────────────────────────────────────────────
const mermas = [
  { producto_id: P.hit.id, cantidad: 6, motivo: 'vencido', creado_en: enHora(dia(HOY, -5), 15) },
  { producto_id: P.club.id, cantidad: 2, motivo: 'averia', creado_en: enHora(dia(HOY, -11), 17) },
]
await insertar('mermas', mermas)
await insertar('movimientos_inventario', mermas.map((m) => ({
  producto_id: m.producto_id, tipo: 'merma', cantidad: -m.cantidad,
  referencia: m.motivo, creado_en: m.creado_en,
})))
for (const m of mermas) consumo.set(m.producto_id, (consumo.get(m.producto_id) ?? 0) + m.cantidad)

// ── 7 · Gastos y caja menor ─────────────────────────────────────────────────
const GASTOS = [
  { categoria: 'arriendo', descripcion: 'Arriendo del local', valor: 1200000, paga_con: 'transferencia', d: -30 },
  { categoria: 'servicios', descripcion: 'Energía', valor: 285000, paga_con: 'transferencia', d: -26 },
  { categoria: 'servicios', descripcion: 'Internet', valor: 95000, paga_con: 'transferencia', d: -25 },
  { categoria: 'transporte', descripcion: 'Flete del pedido', valor: 120000, paga_con: 'caja', d: -21 },
  { categoria: 'nomina', descripcion: 'Quincena', valor: 650000, paga_con: 'transferencia', d: -14 },
  { categoria: 'otros', descripcion: 'Bolsas y aseo', valor: 38000, paga_con: 'caja_menor', d: -12 },
  { categoria: 'servicios', descripcion: 'Agua', valor: 72000, paga_con: 'transferencia', d: -8 },
  { categoria: 'otros', descripcion: 'Recarga de gas del nevecón', valor: 45000, paga_con: 'caja_menor', d: -4 },
]
const gastos = await insertar('gastos', GASTOS.map((g) => ({
  categoria: g.categoria, descripcion: g.descripcion, valor: g.valor, paga_con: g.paga_con,
  fecha: dia(HOY, g.d), creado_en: enHora(dia(HOY, g.d), 12),
})))

// Caja menor: se repone y de ahí salen los gastos pequeños.
const deCajaMenor = GASTOS.map((g, i) => ({ ...g, id: gastos[i].id })).filter((g) => g.paga_con === 'caja_menor')
await insertar('movimientos_caja_menor', [
  { tipo: 'reposicion', valor: 300000, concepto: 'Reposición del fondo', origen: 'transferencia', creado_en: enHora(dia(HOY, -20), 9) },
  ...deCajaMenor.map((g) => ({ tipo: 'gasto', valor: g.valor, gasto_id: g.id, concepto: g.descripcion, creado_en: enHora(dia(HOY, g.d), 12) })),
])
const saldoCajaMenor = 300000 - deCajaMenor.reduce((s, g) => s + g.valor, 0)
const cm = (await db.from('caja_menor').select('id,saldo')).data?.[0]
if (cm) {
  creado.caja_menor = { id: cm.id, saldo_anterior: cm.saldo }
  await db.from('caja_menor').update({ saldo: saldoCajaMenor }).eq('id', cm.id)
}
console.log('  gastos: ' + GASTOS.length + ' · caja menor: ' + saldoCajaMenor.toLocaleString('es-CO'))

// ── 8 · Existencias finales (alta + compras − ventas − mermas) ──────────────
const entradasCompra = new Map()
for (const c of compras) for (const i of c.items) entradasCompra.set(i.p.id, (entradasCompra.get(i.p.id) ?? 0) + i.unidades)
for (const c of CATALOGO) {
  const p = P[c.k]
  const final = c.inicial + (entradasCompra.get(p.id) ?? 0) - (consumo.get(p.id) ?? 0)
  await db.from('productos').update({ existencias: final }).eq('id', p.id)
}
console.log('  existencias ajustadas al movimiento real')

writeFileSync(REGISTRO, JSON.stringify({ sembrado_en: new Date().toISOString(), ...creado }, null, 1))
console.log('\nListo. Registro en ' + REGISTRO)
