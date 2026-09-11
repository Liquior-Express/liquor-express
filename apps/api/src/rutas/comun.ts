// Utilidades compartidas por las rutas del API.

// Fecha de hoy en Colombia (AAAA-MM-DD). Colombia es UTC-5 todo el año.
export const hoy = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' })
export const diaDe = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Bogota' })
export const inicioDia = (fecha: string) => `${fecha}T00:00:00-05:00`
export const finDia = (fecha: string) => `${fecha}T23:59:59.999-05:00`
export const primerDiaMes = () => hoy().slice(0, 8) + '01'

export const r2 = (n: number) => Math.round(n * 100) / 100
export const a50 = (n: number) => Math.round(n / 50) * 50 // pesos: la moneda más pequeña es de $50
export const suma = (arr: any[], f: (x: any) => any) => arr.reduce((a, x) => a + (Number(f(x)) || 0), 0)

// Costo del producto = promedio de sus costos por origen (un solo stock); el margen se recalcula con el precio fijo.
export async function recalcularCosto(db: () => any, productoId: string) {
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

// Descuenta unidades de los lotes de un producto: primero el que vence antes.
export async function descontarLotes(db: () => any, productoId: string, unidades: number) {
  let resto = Number(unidades)
  if (!(resto > 0)) return
  const { data: lotes } = await db().from('lotes').select('id, cantidad')
    .eq('producto_id', productoId).gt('cantidad', 0)
    .order('fecha_vencimiento', { ascending: true, nullsFirst: false })
  for (const l of lotes ?? []) {
    if (resto <= 0) break
    const quita = Math.min(Number(l.cantidad), resto)
    await db().from('lotes').update({ cantidad: Number(l.cantidad) - quita }).eq('id', l.id)
    resto -= quita
  }
}
