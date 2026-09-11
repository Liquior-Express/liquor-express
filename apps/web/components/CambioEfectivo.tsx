'use client'

import { useState } from 'react'

// Pago en efectivo: con cuánto paga el cliente → cuánto se le devuelve, al instante.
const money = (n: number) => '$' + Math.round(Number(n) || 0).toLocaleString('es-CO')
const BILLETES = [10000, 20000, 50000, 100000]

export function CambioEfectivo({ total }: { total: number }) {
  const [recibido, setRecibido] = useState('')
  const r = Number(recibido) || 0
  const cambio = r - total

  // Atajos: exacto + montos redondos que cubren el total.
  const sugeridos = total > 0
    ? [...new Set([total, Math.ceil(total / 10000) * 10000, Math.ceil(total / 50000) * 50000, ...BILLETES.filter((b) => b >= total)])]
        .sort((a, b) => a - b).slice(0, 5)
    : []

  return (
    <div className="cambio">
      <div className="field">
        <label>Recibido en efectivo</label>
        <input type="number" inputMode="numeric" value={recibido} placeholder="¿Con cuánto paga?" onChange={(e) => setRecibido(e.target.value)} />
      </div>
      {sugeridos.length > 0 && (
        <div className="pos-chips" style={{ marginTop: 6 }}>
          {sugeridos.map((v) => (
            <button key={v} type="button" className="pos-chip" onClick={() => setRecibido(String(v))}>
              {v === total ? 'Exacto' : money(v)}
            </button>
          ))}
        </div>
      )}
      {r > 0 && (cambio >= 0
        ? <div className="cambio-valor">Devolver <b>{money(cambio)}</b></div>
        : <div className="alert" style={{ marginTop: 8 }}>Faltan {money(-cambio)}</div>)}
    </div>
  )
}
