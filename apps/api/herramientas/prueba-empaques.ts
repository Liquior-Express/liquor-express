/**
 * Prueba del control por empaques (sin base de datos).
 *
 *   npx tsx apps/api/herramientas/prueba-empaques.ts
 *
 * Recorre un día de cigarrillos: abrir empaques, vender cerrados y sueltos, recibir, contar;
 * y en cada paso comprueba que el total en unidades cuadre con lo que se movió.
 */
import { aplicarEmpaques, unidadesDe, avisosEmpaques, type EstadoEmpaques } from '../src/rutas/empaques.ts'
import { resumirEmpaques, sueltosFaltantes, cerradasDisponibles, podarAperturas } from '../../web/lib/empaques.ts'

let fallas = 0
const igual = (nombre: string, obtenido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtenido) === JSON.stringify(esperado)
  if (!ok) fallas++
  console.log(`${ok ? 'OK ' : 'MAL'} ${nombre}${ok ? '' : ` → obtuvo ${JSON.stringify(obtenido)}, esperaba ${JSON.stringify(esperado)}`}`)
}

const CAJ = 'cajetilla', MED = 'media'
const factores = { [CAJ]: 20, [MED]: 10 }
const pres = [
  { id: MED, producto_id: 'marlboro', nombre: 'Media cajetilla', factor_unidades: 10, cerradas: 3 },
  { id: CAJ, producto_id: 'marlboro', nombre: 'Cajetilla', factor_unidades: 20, cerradas: 12 },
]

// ── Backend: estado de inventario ──
let e: EstadoEmpaques = { sueltos: 7, cerradas: { [CAJ]: 12, [MED]: 3 } }
let total = unidadesDe(e, factores)
igual('conteo inicial: 12 cajetillas, 3 medias y 7 sueltos = 277 und', total, 277)

// Venta de 10 sueltos abriendo una cajetilla.
e = aplicarEmpaques(e, { aperturas: [{ presentacion_id: CAJ, factor: 20 }], sueltos: -10 })
igual('abre cajetilla y vende 10 sueltos → 11 cajetillas, 17 sueltos', e, { sueltos: 17, cerradas: { [CAJ]: 11, [MED]: 3 } })
igual('el total baja exactamente 10', unidadesDe(e, factores), total - 10); total -= 10

// Venta de 1 cajetilla y 2 medias cerradas.
e = aplicarEmpaques(e, { cerradas: [{ presentacion_id: CAJ, cantidad: -1 }, { presentacion_id: MED, cantidad: -2 }] })
igual('vende 1 cajetilla y 2 medias → 10 cajetillas y 1 media', e.cerradas, { [CAJ]: 10, [MED]: 1 })
igual('el total baja 40', unidadesDe(e, factores), total - 40); total -= 40

// Compra de 5 cajetillas; anulación que devuelve 3 sueltos.
e = aplicarEmpaques(e, { cerradas: [{ presentacion_id: CAJ, cantidad: 5 }] })
e = aplicarEmpaques(e, { sueltos: 3 })
igual('recibe 5 cajetillas y vuelven 3 sueltos', e, { sueltos: 20, cerradas: { [CAJ]: 15, [MED]: 1 } })
igual('el total sube 103', unidadesDe(e, factores), total + 103); total += 103

// Abrir un empaque no cambia el total.
e = aplicarEmpaques(e, { aperturas: [{ presentacion_id: MED, factor: 10 }] })
igual('abrir una media no cambia el total', unidadesDe(e, factores), total)
igual('sin negativos no hay avisos', avisosEmpaques('Marlboro', e, { [CAJ]: 'Cajetilla', [MED]: 'Media cajetilla' }), [])

// Vender sin abrir deja sueltos en negativo y avisa.
const negativo = aplicarEmpaques({ sueltos: 2, cerradas: { [CAJ]: 0 } }, { sueltos: -5 })
igual('vender sin abrir avisa para revisar el conteo', avisosEmpaques('Marlboro', negativo, { [CAJ]: 'Cajetilla' }), ['Marlboro: sueltos en -3, revisa el conteo'])

// ── Pantalla de ventas: qué abrir ──
igual('resumen legible', resumirEmpaques(7, pres), '12× Cajetilla · 3× Media cajetilla · 7 sueltos')
igual('con 7 sueltos y 10 pedidos faltan 3', sueltosFaltantes(7, 10, [], pres), 3)
const abreMedia = [{ producto_id: 'marlboro', presentacion_id: MED }]
igual('abriendo una media ya alcanza', sueltosFaltantes(7, 10, abreMedia, pres) <= 0, true)
igual('quedan 2 medias para abrir si ya se abre 1', cerradasDisponibles(pres[0], 0, abreMedia), 2)
igual('si la venta lleva 12 cajetillas cerradas, no queda ninguna para abrir', cerradasDisponibles(pres[1], 12, []), 0)
const dos = [...abreMedia, { producto_id: 'marlboro', presentacion_id: CAJ }]
igual('si sobra la segunda apertura, se desmarca', podarAperturas(7, 10, dos, pres), abreMedia)
igual('si se quitaron los sueltos, no se abre nada', podarAperturas(7, 5, abreMedia, pres), [])

console.log(fallas ? `\n${fallas} prueba(s) fallaron` : '\nTodas las pruebas pasaron')
process.exit(fallas ? 1 : 0)
