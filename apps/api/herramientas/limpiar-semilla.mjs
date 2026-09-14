/**
 * Borra la semilla de demostración — Liquor Express (JCA Soft · Kaizen)
 *
 *   node apps/api/herramientas/limpiar-semilla.mjs
 *
 * Solo borra lo que quedó anotado en `.semilla.json`. Lo que el negocio haya
 * creado por su cuenta no se toca. Si mientras tanto se registraron ventas
 * sobre productos de la semilla, avisa y no borra esos productos.
 */
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { readFileSync, existsSync, renameSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const AQUI = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(AQUI, '../.env') })
const REGISTRO = resolve(AQUI, '.semilla.json')

if (!existsSync(REGISTRO)) {
  console.error('No hay semilla sembrada (falta .semilla.json).')
  process.exit(1)
}
const reg = JSON.parse(readFileSync(REGISTRO, 'utf8'))
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

// Orden que respeta las llaves foráneas (primero los hijos).
const ORDEN = [
  'venta_items', 'ventas', 'movimientos_caja', 'sesiones_caja',
  'compra_items', 'compras', 'movimientos_caja_menor', 'gastos',
  'movimientos_inventario', 'mermas', 'lotes', 'costos_origen',
  'presentaciones', 'productos', 'categorias', 'proveedores',
]

// Aviso: ventas ajenas a la semilla sobre productos de la semilla.
if (reg.productos?.length) {
  const { data: ajenas } = await db.from('venta_items').select('producto_id').in('producto_id', reg.productos)
  const propios = new Set(reg.venta_items ?? [])
  const { data: todos } = await db.from('venta_items').select('id,producto_id').in('producto_id', reg.productos)
  const extra = (todos ?? []).filter((v) => !propios.has(v.id))
  if (extra.length) {
    console.log('Aviso: hay ' + extra.length + ' línea(s) de venta hechas por fuera de la semilla sobre estos productos.')
    console.log('Se borrarán también, porque pertenecen a productos de demostración.\n')
    const ids = [...new Set(extra.map((v) => v.producto_id))]
    const { data: ventasExtra } = await db.from('venta_items').select('venta_id').in('producto_id', ids)
    const vIds = [...new Set((ventasExtra ?? []).map((v) => v.venta_id))]
    await db.from('venta_items').delete().in('venta_id', vIds)
    await db.from('ventas').delete().in('id', vIds)
  }
  void ajenas
}

for (const tabla of ORDEN) {
  const ids = reg[tabla] ?? []
  if (!ids.length) continue
  // Por lotes, para no armar URLs enormes.
  let borrados = 0
  for (let i = 0; i < ids.length; i += 100) {
    const parte = ids.slice(i, i + 100)
    const { error, count } = await db.from(tabla).delete({ count: 'exact' }).in('id', parte)
    if (error) { console.error('  ' + tabla + ': ' + error.message); break }
    borrados += count ?? 0
  }
  console.log('  ' + tabla + ': ' + borrados + ' borrados')
}

if (reg.tasa_real?.length) {
  const { count } = await db.from('tasa_real').delete({ count: 'exact' }).in('fecha', reg.tasa_real)
  console.log('  tasa_real: ' + (count ?? 0) + ' borrados')
}
if (reg.caja_menor) {
  await db.from('caja_menor').update({ saldo: reg.caja_menor.saldo_anterior }).eq('id', reg.caja_menor.id)
  console.log('  caja menor: saldo devuelto a ' + reg.caja_menor.saldo_anterior)
}

renameSync(REGISTRO, REGISTRO + '.borrada')
console.log('\nListo. La semilla quedó borrada.')
