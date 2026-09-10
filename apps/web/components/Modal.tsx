'use client'

import { useEffect } from 'react'

export function Modal({
  open, title, onClose, children, ancho = 440,
}: {
  open: boolean
  title?: string
  onClose: () => void
  children: React.ReactNode
  ancho?: number
}) {
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', h); document.body.style.overflow = '' }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal-card" style={{ maxWidth: ancho }} onMouseDown={(e) => e.stopPropagation()}>
        {title && (
          <div className="row-between" style={{ marginBottom: 16 }}>
            <h3 className="muted" style={{ fontWeight: 600 }}>{title}</h3>
            <button className="link-btn" aria-label="Cerrar" onClick={onClose}>✕</button>
          </div>
        )}
        {children}
      </div>
    </div>
  )
}
