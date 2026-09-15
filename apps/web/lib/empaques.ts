// Control por empaques en el navegador (cigarrillos): resumen para mostrar y cálculo de qué
// empaque abrir al vender sueltos. Solo aplica a productos con controla_empaques.

export interface PresEmp { id: string; producto_id?: string; nombre: string; factor_unidades: number; cerradas?: number }
export interface Apertura { producto_id: string; presentacion_id: string }

const empaquesDe = (presentaciones: PresEmp[]) =>
  presentaciones.filter((p) => Number(p.factor_unidades) > 1).sort((a, b) => b.factor_unidades - a.factor_unidades)

// "12× Cajetilla · 3× Media cajetilla · 7 sueltos"
export function resumirEmpaques(sueltos: number | undefined, presentaciones: PresEmp[]): string {
  const partes = empaquesDe(presentaciones).map((p) => `${Number(p.cerradas) || 0}× ${p.nombre}`)
  partes.push(`${Number(sueltos) || 0} sueltos`)
  return partes.join(' · ')
}

const factorDe = (presentaciones: PresEmp[], id: string) => Number(presentaciones.find((p) => p.id === id)?.factor_unidades) || 0

// Sueltos que faltan para lo pedido, contando los empaques que ya se decidió abrir (≤ 0: alcanza).
export function sueltosFaltantes(sueltos: number | undefined, pedidos: number, aperturas: Apertura[], presentaciones: PresEmp[]): number {
  const abiertos = aperturas.reduce((s, a) => s + factorDe(presentaciones, a.presentacion_id), 0)
  return pedidos - (Number(sueltos) || 0) - abiertos
}

// Empaques cerrados que quedan para abrir: los cerrados, menos los que van cerrados en la
// venta y los que ya se marcaron para abrir.
export function cerradasDisponibles(p: PresEmp, enVenta: number, aperturas: Apertura[]): number {
  return (Number(p.cerradas) || 0) - enVenta - aperturas.filter((a) => a.presentacion_id === p.id).length
}

// Quita del final las aperturas que ya no hacen falta (por ejemplo, si se quitó un suelto).
export function podarAperturas(sueltos: number | undefined, pedidos: number, aperturas: Apertura[], presentaciones: PresEmp[]): Apertura[] {
  const lista = [...aperturas]
  while (lista.length && sueltosFaltantes(sueltos, pedidos, lista.slice(0, -1), presentaciones) <= 0) lista.pop()
  return lista
}
