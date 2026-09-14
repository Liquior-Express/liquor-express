// Puesto en el podio de más vendidos: corona, plata y bronce para los tres
// primeros; del cuarto en adelante, el número discreto. Es a propósito
// didáctico — el tablero se lee de un vistazo, sin tener que comparar cifras.

const MEDALLA: Record<number, { icono: string; nombre: string }> = {
  1: { icono: '👑', nombre: 'Primer puesto' },
  2: { icono: '🥈', nombre: 'Segundo puesto' },
  3: { icono: '🥉', nombre: 'Tercer puesto' },
}

export function Posicion({ n }: { n: number }) {
  const m = MEDALLA[n]
  if (m) return <span className={'podio p' + n} title={m.nombre} aria-label={m.nombre}>{m.icono}</span>
  return <span className="podio otro" title={'Puesto ' + n}>#{n}</span>
}
