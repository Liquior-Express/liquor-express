'use client'

// Pago en efectivo, en pesos o en reales: cuánto se recibe y cuánto se devuelve.
// El cambio de un pago en reales se puede dar en reales o en pesos.
export interface PagoEfectivo { moneda: 'COP' | 'BRL'; recibido: string; cambioEn: 'COP' | 'BRL' }
export const PAGO_INICIAL: PagoEfectivo = { moneda: 'COP', recibido: '', cambioEn: 'BRL' }

const money = (n: number) => '$' + Math.round(Number(n) || 0).toLocaleString('es-CO')
const reales = (n: number) => 'R$ ' + (Number(n) || 0).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const a50 = (n: number) => Math.round(n / 50) * 50

export function CambioEfectivo({ total, tasa, valor, onChange }: {
  total: number; tasa: number | null; valor: PagoEfectivo; onChange: (v: PagoEfectivo) => void
}) {
  const enReales = valor.moneda === 'BRL'
  const totalR = enReales && tasa ? Math.round((total / tasa) * 100) / 100 : 0
  const aPagar = enReales ? totalR : total
  const r = Number(valor.recibido) || 0
  const cambio = Math.round((r - aPagar) * 100) / 100
  const cambioPesos = enReales && tasa ? a50(cambio * tasa) : cambio
  const fmt = enReales ? reales : money
  const set = (p: Partial<PagoEfectivo>) => onChange({ ...valor, ...p })

  // Atajos: exacto + montos redondos + billetes que cubren el total.
  const billetes = enReales ? [10, 20, 50, 100, 200] : [10000, 20000, 50000, 100000]
  const redondos = enReales ? [Math.ceil(aPagar / 5) * 5, Math.ceil(aPagar / 10) * 10] : [Math.ceil(aPagar / 10000) * 10000, Math.ceil(aPagar / 50000) * 50000]
  const sugeridos = aPagar > 0 ? [...new Set([aPagar, ...redondos, ...billetes.filter((b) => b >= aPagar)])].sort((a, b) => a - b).slice(0, 5) : []

  return (
    <div className="cambio">
      <div className="segmento">
        <button type="button" className={!enReales ? 'activo' : ''} onClick={() => set({ moneda: 'COP', recibido: '' })}>Paga en pesos</button>
        <button type="button" className={enReales ? 'activo' : ''} onClick={() => set({ moneda: 'BRL', recibido: '' })}>Paga en reales</button>
      </div>

      {enReales && !tasa ? (
        <div className="alert" style={{ marginTop: 8 }}>Falta la tasa del Real de hoy.</div>
      ) : (
        <>
          {enReales && <div className="muted" style={{ marginTop: 8 }}>A pagar: <b>{reales(totalR)}</b> <span className="faint">(1 R$ = {money(tasa as number)})</span></div>}
          <div className="field" style={{ marginTop: 8 }}>
            <label>Recibido en {enReales ? 'reales' : 'pesos'}</label>
            <input type="number" inputMode="decimal" step={enReales ? '0.01' : '1'} value={valor.recibido}
              placeholder="¿Con cuánto paga?" onChange={(e) => set({ recibido: e.target.value })} />
          </div>
          {sugeridos.length > 0 && (
            <div className="pos-chips" style={{ marginTop: 6 }}>
              {sugeridos.map((v) => (
                <button key={v} type="button" className="pos-chip" onClick={() => set({ recibido: String(v) })}>{v === aPagar ? 'Exacto' : fmt(v)}</button>
              ))}
            </div>
          )}
          {r > 0 && (cambio < 0 ? (
            <div className="alert" style={{ marginTop: 8 }}>Faltan {fmt(-cambio)}</div>
          ) : !enReales ? (
            <div className="cambio-valor">Devolver <b>{money(cambio)}</b></div>
          ) : (
            <div style={{ marginTop: 8 }}>
              <div className="faint" style={{ marginBottom: 4 }}>Devolver en:</div>
              <div className="segmento">
                <button type="button" className={valor.cambioEn === 'BRL' ? 'activo' : ''} onClick={() => set({ cambioEn: 'BRL' })}>{reales(cambio)}</button>
                <button type="button" className={valor.cambioEn === 'COP' ? 'activo' : ''} onClick={() => set({ cambioEn: 'COP' })}>{money(cambioPesos)}</button>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  )
}
