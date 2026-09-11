// Reparte unas existencias (en unidades) entre las presentaciones del producto,
// de la más grande a la más pequeña. Ej.: 75 und con Caja(30) y Six(6) → "2× Caja · 2× Six · 3 und".
export interface PresBasica { nombre: string; factor_unidades: number }

export function desglosar(unidades: number, presentaciones: PresBasica[], unidadBase = 'und'): string {
  let resto = Math.floor(Number(unidades) || 0)
  const grandes = presentaciones.filter((p) => Number(p.factor_unidades) > 1).sort((a, b) => b.factor_unidades - a.factor_unidades)
  if (resto <= 0 || grandes.length === 0) return ''
  const partes: string[] = []
  for (const p of grandes) {
    const n = Math.floor(resto / p.factor_unidades)
    if (n > 0) { partes.push(`${n}× ${p.nombre}`); resto -= n * p.factor_unidades }
  }
  if (partes.length === 0) return ''
  if (resto > 0) partes.push(`${resto} ${unidadBase}`)
  return partes.join(' · ')
}
