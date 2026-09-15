// País de origen como etiqueta de texto (CO / BR). Reemplaza las banderas emoji,
// que Windows no dibuja y muestra como letras sueltas.
export function Pais({ origen }: { origen: string }) {
  const brasil = origen === 'brasil'
  return <span className={'pais ' + (brasil ? 'br' : 'co')} title={brasil ? 'Brasil' : 'Colombia'}>{brasil ? 'BR' : 'CO'}</span>
}
