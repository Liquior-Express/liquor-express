'use client'

import { createContext, useContext, useState, useCallback, useRef } from 'react'
import { Modal } from './Modal'

interface PedirOpts {
  title?: string; label?: string; placeholder?: string
  type?: 'text' | 'password' | 'number'; initial?: string; confirmText?: string; min?: number
}
interface ConfirmOpts {
  title?: string; message?: string; confirmText?: string; peligro?: boolean
}

interface API {
  pedir: (o: PedirOpts) => Promise<string | null>
  confirmar: (o: ConfirmOpts) => Promise<boolean>
}

const Ctx = createContext<API | null>(null)
export const useDialog = (): API => {
  const c = useContext(Ctx)
  if (!c) throw new Error('Falta <DialogProvider>')
  return c
}

type Estado =
  | { tipo: 'pedir'; opts: PedirOpts }
  | { tipo: 'confirmar'; opts: ConfirmOpts }
  | null

export function DialogProvider({ children }: { children: React.ReactNode }) {
  const [estado, setEstado] = useState<Estado>(null)
  const [valor, setValor] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const resolver = useRef<((v: any) => void) | undefined>(undefined)

  const pedir = useCallback((opts: PedirOpts) =>
    new Promise<string | null>((res) => {
      resolver.current = res
      setValor(opts.initial ?? ''); setErr(null)
      setEstado({ tipo: 'pedir', opts })
    }), [])

  const confirmar = useCallback((opts: ConfirmOpts) =>
    new Promise<boolean>((res) => {
      resolver.current = res
      setEstado({ tipo: 'confirmar', opts })
    }), [])

  function cerrar(resultado: string | null | boolean) {
    resolver.current?.(resultado)
    resolver.current = undefined
    setEstado(null)
  }

  function aceptarPedir(e: React.FormEvent) {
    e.preventDefault()
    if (estado?.tipo !== 'pedir') return
    const v = valor.trim()
    const min = estado.opts.min ?? (estado.opts.type === 'password' ? 1 : 1)
    if (v.length < min) { setErr(min > 1 ? `Mínimo ${min} caracteres` : 'Este campo es obligatorio'); return }
    cerrar(v)
  }

  return (
    <Ctx.Provider value={{ pedir, confirmar }}>
      {children}
      <Modal
        open={!!estado}
        title={estado?.opts.title}
        onClose={() => cerrar(estado?.tipo === 'confirmar' ? false : null)}
      >
        {estado?.tipo === 'pedir' && (
          <form className="form" style={{ marginTop: 0 }} onSubmit={aceptarPedir}>
            <div className="field">
              {estado.opts.label && <label>{estado.opts.label}</label>}
              <input
                autoFocus
                type={estado.opts.type ?? 'text'}
                value={valor}
                placeholder={estado.opts.placeholder}
                onChange={(e) => setValor(e.target.value)}
              />
            </div>
            {err && <div className="alert">{err}</div>}
            <div style={{ display: 'flex', gap: 10 }}>
              <button type="button" className="btn ghost" style={{ flex: 1, marginTop: 0 }} onClick={() => cerrar(null)}>Cancelar</button>
              <button type="submit" className="btn" style={{ flex: 1, marginTop: 0 }}>{estado.opts.confirmText ?? 'Aceptar'}</button>
            </div>
          </form>
        )}

        {estado?.tipo === 'confirmar' && (
          <div>
            {estado.opts.message && <p className="muted" style={{ lineHeight: 1.55 }}>{estado.opts.message}</p>}
            <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
              <button className="btn ghost" style={{ flex: 1, marginTop: 0 }} onClick={() => cerrar(false)}>Cancelar</button>
              <button
                className={`btn${estado.opts.peligro ? ' peligro' : ''}`}
                style={{ flex: 1, marginTop: 0 }}
                onClick={() => cerrar(true)}
              >
                {estado.opts.confirmText ?? 'Confirmar'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </Ctx.Provider>
  )
}
