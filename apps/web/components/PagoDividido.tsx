'use client'

// Pago dividido: una misma venta pagada con varios medios (pesos, reales, Nequi, Bold, PIX).
// Cada parte se escribe en su moneda; lo que se paga en reales se pasa a pesos con la tasa de hoy.
// Si sobra, es cambio y solo se da del efectivo, en pesos o en reales.

export type TipoParte = 'cop' | 'brl' | 'nequi' | 'bold' | 'pix'
export interface ParteUI { id: string; tipo: TipoParte; monto: string }

export const TIPOS_PARTE: { id: TipoParte; label: string; medio: string; moneda: 'COP' | 'BRL' }[] = [
  { id: 'cop', label: '💵 Efectivo pesos', medio: 'efectivo', moneda: 'COP' },
  { id: 'brl', label: '💵 Efectivo reales', medio: 'efectivo', moneda: 'BRL' },
  { id: 'nequi', label: '📱 Nequi', medio: 'nequi', moneda: 'COP' },
  { id: 'bold', label: '💳 Bold', medio: 'bold', moneda: 'COP' },
  { id: 'pix', label: '💠 PIX (R$)', medio: 'pix', moneda: 'BRL' },
]
const tipoDe = (t: TipoParte) => TIPOS_PARTE.find((x) => x.id === t)!

const money = (n: number) => '$' + Math.round(Number(n) || 0).toLocaleString('es-CO')
const reales = (n: number) => 'R$ ' + (Number(n) || 0).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const a50 = (n: number) => Math.round(n / 50) * 50

let contador = 0
export const nuevaParte = (tipo: TipoParte, monto = ''): ParteUI => ({ id: 'p' + ++contador, tipo, monto })
export const PARTES_INICIALES = (): ParteUI[] => [nuevaParte('cop'), nuevaParte('nequi')]

// Cuánto va pagado, cuánto falta o sobra y si ya se puede cobrar.
export function calcularDividido(partes: ParteUI[], total: number, tasa: number | null) {
  const faltaTasa = !tasa && partes.some((p) => tipoDe(p.tipo).moneda === 'BRL')
  const pesosDe = (p: ParteUI) => {
    const m = Number(p.monto) || 0
    return tipoDe(p.tipo).moneda === 'BRL' ? Math.round(m * (tasa ?? 0)) : Math.round(m)
  }
  const pagado = partes.reduce((s, p) => s + pesosDe(p), 0)
  const efectivo = partes.filter((p) => tipoDe(p.tipo).medio === 'efectivo').reduce((s, p) => s + pesosDe(p), 0)
  const falta = total - pagado
  const exceso = Math.max(0, pagado - total)
  const completo = partes.length >= 2 && partes.every((p) => Number(p.monto) > 0) && !faltaTasa
    && falta <= 50 && exceso <= efectivo
  return { pesosDe, pagado, falta, exceso, efectivo, faltaTasa, completo }
}

export const partesAlServidor = (partes: ParteUI[]) =>
  partes.map((p) => ({ medio: tipoDe(p.tipo).medio, moneda: tipoDe(p.tipo).moneda, monto: Number(p.monto) }))

// Para corregir una venta dividida: las partes guardadas vuelven al formulario.
export const partesDesdeServidor = (pagos: { medio: string; moneda: string; monto: number }[]): ParteUI[] =>
  pagos.map((p) => nuevaParte(
    p.medio === 'efectivo' ? (p.moneda === 'BRL' ? 'brl' : 'cop') : (p.medio as TipoParte),
    String(Number(p.monto)),
  ))

export function PagoDividido({ total, tasa, partes, onChange, cambioEn, onCambioEn }: {
  total: number; tasa: number | null; partes: ParteUI[]; onChange: (p: ParteUI[]) => void
  cambioEn: 'COP' | 'BRL'; onCambioEn: (m: 'COP' | 'BRL') => void
}) {
  const c = calcularDividido(partes, total, tasa)
  const set = (id: string, cambio: Partial<ParteUI>) => onChange(partes.map((p) => (p.id === id ? { ...p, ...cambio } : p)))

  // "Resto": la parte cubre lo que falta, en su moneda.
  function resto(p: ParteUI) {
    const pendiente = c.falta + c.pesosDe(p)
    if (pendiente <= 0) return
    if (tipoDe(p.tipo).moneda === 'BRL') {
      if (!tasa) return
      set(p.id, { monto: String(Math.ceil((pendiente / tasa) * 100) / 100) })
    } else set(p.id, { monto: String(Math.round(pendiente)) })
  }

  return (
    <div className="dividido">
      <div className="cambio-titulo">Pago dividido · {money(total)}</div>
      {partes.map((p) => {
        const t = tipoDe(p.tipo)
        return (
          <div key={p.id} className="dividido-parte">
            <select className="celda" value={p.tipo} aria-label="Medio de esta parte"
              onChange={(e) => set(p.id, { tipo: e.target.value as TipoParte, monto: '' })}>
              {TIPOS_PARTE.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
            </select>
            <div className="dividido-monto">
              <span className="faint">{t.moneda === 'BRL' ? 'R$' : '$'}</span>
              <input className="celda" type="number" inputMode="decimal" step={t.moneda === 'BRL' ? '0.01' : '50'} min="0"
                aria-label="Valor de esta parte" placeholder="0" value={p.monto} onChange={(e) => set(p.id, { monto: e.target.value })} />
              <button type="button" className="pos-chip" title="Cubrir lo que falta con esta parte" onClick={() => resto(p)}>Resto</button>
              {partes.length > 2 && (
                <button type="button" className="link-btn" aria-label="Quitar parte" onClick={() => onChange(partes.filter((x) => x.id !== p.id))}>✕</button>
              )}
            </div>
            {t.moneda === 'BRL' && Number(p.monto) > 0 && tasa && <span className="faint">= {money(c.pesosDe(p))}</span>}
          </div>
        )
      })}
      <button type="button" className="link-btn" onClick={() => onChange([...partes, nuevaParte('cop')])}>＋ Agregar otra parte</button>

      {c.faltaTasa ? (
        <div className="alert" style={{ marginTop: 8 }}>Falta la tasa del Real de hoy para las partes en reales.</div>
      ) : c.falta > 50 ? (
        <div className="alert" style={{ marginTop: 8 }}>Faltan <b>{money(c.falta)}</b></div>
      ) : c.exceso > 0 ? (
        c.exceso > c.efectivo ? (
          <div className="alert" style={{ marginTop: 8 }}>Sobran {money(c.exceso)}: el cambio solo se da del efectivo.</div>
        ) : (
          <div style={{ marginTop: 8 }}>
            <div className="faint" style={{ marginBottom: 4 }}>Devolver en:</div>
            <div className="segmento">
              <button type="button" className={cambioEn === 'COP' ? 'activo' : ''} onClick={() => onCambioEn('COP')}>{money(a50(c.exceso))}</button>
              <button type="button" className={cambioEn === 'BRL' ? 'activo' : ''} disabled={!tasa} onClick={() => onCambioEn('BRL')}>
                {tasa ? reales(Math.round((c.exceso / tasa) * 100) / 100) : 'Reales'}
              </button>
            </div>
          </div>
        )
      ) : c.pagado > 0 && (
        <div className="cambio-valor">Completo ✓</div>
      )}
    </div>
  )
}
