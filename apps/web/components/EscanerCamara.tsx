'use client'

// Escáner de códigos de barras con la cámara del celular o del PC. Usa el lector nativo del
// navegador cuando existe (Chrome en Android) y, si no, ZXing en WebAssembly (iPhone, Windows),
// servido desde la propia app (/zxing_reader.wasm) para que funcione sin internet.
// Ojo: los navegadores solo abren la cámara en páginas seguras (https o localhost).
import { useEffect, useRef, useState } from 'react'
import { Modal } from './Modal'

// Formatos de los productos de la licorera: EAN/UPC en empaques, Code 128/39 e ITF en cajas.
const FORMATOS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf']

interface Detector { detect: (fuente: HTMLVideoElement) => Promise<{ rawValue: string }[]> }

let zxingPreparado = false
export async function crearDetector(): Promise<Detector> {
  const Nativo = (globalThis as any).BarcodeDetector
  if (Nativo) {
    try {
      const soportados: string[] = await Nativo.getSupportedFormats()
      const formats = FORMATOS.filter((f) => soportados.includes(f))
      if (formats.includes('ean_13')) return new Nativo({ formats })
    } catch { /* sin lector nativo útil: se usa ZXing */ }
  }
  const { BarcodeDetector, prepareZXingModule } = await import('barcode-detector/ponyfill')
  if (!zxingPreparado) {
    prepareZXingModule({
      overrides: { locateFile: (ruta: string, prefijo: string) => (ruta.endsWith('.wasm') ? '/zxing_reader.wasm' : prefijo + ruta) },
    })
    zxingPreparado = true
  }
  return new BarcodeDetector({ formats: FORMATOS as any }) as unknown as Detector
}

// Pitido corto (y vibración en el celular) para confirmar cada lectura sin mirar la pantalla.
function pitar() {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext
    const ctx = new Ctx()
    const osc = ctx.createOscillator()
    const vol = ctx.createGain()
    osc.frequency.value = 1400
    vol.gain.value = 0.08
    osc.connect(vol); vol.connect(ctx.destination)
    osc.start(); osc.stop(ctx.currentTime + 0.09)
    osc.onended = () => ctx.close()
  } catch { /* sin audio no pasa nada */ }
  navigator.vibrate?.(40)
}

export function EscanerCamara({ open, onClose, onCodigo, continuo = false, titulo = 'Escanear con la cámara' }: {
  open: boolean
  onClose: () => void
  /** Recibe cada código leído. Si devuelve un texto, se muestra como confirmación. */
  onCodigo: (codigo: string) => string | void
  /** Continuo: sigue leyendo (ventas). Si no, cierra con la primera lectura (formularios). */
  continuo?: boolean
  titulo?: string
}) {
  const video = useRef<HTMLVideoElement>(null)
  const [estado, setEstado] = useState<'iniciando' | 'leyendo' | 'error'>('iniciando')
  const [error, setError] = useState<string | null>(null)
  const [ultimo, setUltimo] = useState<string | null>(null)
  const alCodigo = useRef(onCodigo)
  const cerrar = useRef(onClose)
  alCodigo.current = onCodigo
  cerrar.current = onClose

  useEffect(() => {
    if (!open) return
    let activo = true
    let flujo: MediaStream | null = null
    let temporizador: number | undefined
    // Un código que sigue frente a la cámara cuenta una sola vez; vuelve a contar solo si salió.
    const vistoPorUltimaVez = new Map<string, number>()
    setEstado('iniciando'); setError(null); setUltimo(null)

    ;(async () => {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        throw new Error('La cámara solo abre en una conexión segura (https). Aquí usa el lector o escribe el código.')
      }
      const [detector, s] = await Promise.all([
        crearDetector(),
        navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false }),
      ])
      flujo = s
      if (!activo) { s.getTracks().forEach((t) => t.stop()); return }
      const v = video.current!
      v.srcObject = s
      await v.play()
      setEstado('leyendo')

      const leer = async () => {
        if (!activo) return
        try {
          if (v.readyState >= 2) {
            const ahora = Date.now()
            for (const { rawValue } of await detector.detect(v)) {
              if (!rawValue) continue
              const antes = vistoPorUltimaVez.get(rawValue) ?? 0
              vistoPorUltimaVez.set(rawValue, ahora)
              if (ahora - antes < 1200) continue
              pitar()
              const respuesta = alCodigo.current(rawValue)
              setUltimo(typeof respuesta === 'string' ? respuesta : rawValue)
              if (!continuo) { cerrar.current(); return }
            }
          }
        } catch { /* cuadro sin código legible: seguir */ }
        temporizador = window.setTimeout(leer, 180)
      }
      leer()
    })().catch((e: any) => {
      if (!activo) return
      setError(
        e?.name === 'NotAllowedError' ? 'El permiso de la cámara está negado. Actívalo en el navegador para escanear.'
          : e?.name === 'NotFoundError' ? 'Este equipo no tiene una cámara disponible.'
            : e?.message ?? 'No se pudo abrir la cámara.',
      )
      setEstado('error')
    })

    return () => {
      activo = false
      window.clearTimeout(temporizador)
      flujo?.getTracks().forEach((t) => t.stop())
    }
  }, [open, continuo])

  return (
    <Modal open={open} title={titulo} onClose={onClose} ancho={480}>
      <div className="escaner">
        <video ref={video} playsInline muted />
        {estado === 'leyendo' && <div className="escaner-guia" />}
        {estado === 'iniciando' && <div className="escaner-estado">Abriendo la cámara…</div>}
        {estado === 'error' && <div className="escaner-estado error">{error}</div>}
      </div>
      <p className="faint" style={{ marginTop: 10, lineHeight: 1.45 }}>
        {continuo ? 'Pasa los productos uno a uno frente a la cámara: cada código entra a la venta.' : 'Centra el código de barras en el recuadro.'}
        {ultimo && <><br />Último: <b style={{ color: 'var(--text)' }}>{ultimo}</b></>}
      </p>
      <button type="button" className="btn" style={{ width: '100%', marginTop: 12 }} onClick={onClose}>{continuo ? 'Listo' : 'Cancelar'}</button>
    </Modal>
  )
}

// Botón 📷 que abre el escáner. Maneja su propio estado para poder ponerlo en cualquier formulario.
export function BotonCamara({ onCodigo, continuo = false, titulo }: {
  onCodigo: (codigo: string) => string | void
  continuo?: boolean
  titulo?: string
}) {
  const [abierto, setAbierto] = useState(false)
  return (
    <>
      <button type="button" className="btn ghost camara-btn" style={{ marginTop: 0 }} title={titulo ?? 'Escanear con la cámara'}
        aria-label="Escanear con la cámara" onClick={() => setAbierto(true)}>📷</button>
      <EscanerCamara open={abierto} continuo={continuo} titulo={titulo} onClose={() => setAbierto(false)} onCodigo={onCodigo} />
    </>
  )
}
