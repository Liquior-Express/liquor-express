'use client'

import { useState } from 'react'
import { Modal } from './Modal'
import { apiFetch } from '../lib/api'

// Importa el catálogo desde Excel (.xlsx/.xls) o CSV. Reconoce las columnas por su título,
// crea los productos nuevos y actualiza los que ya existen (mismo nombre).
const COLUMNAS: { campo: string; titulos: string[]; ejemplo: string | number }[] = [
  { campo: 'nombre', titulos: ['nombre', 'producto', 'descripcion', 'articulo', 'referencia'], ejemplo: 'Aguardiente Amarillo 750 ml' },
  { campo: 'categoria', titulos: ['categoria', 'grupo', 'tipo', 'linea'], ejemplo: 'Aguardientes' },
  { campo: 'codigo_barras', titulos: ['codigo_barras', 'codigo de barras', 'codigo', 'ean', 'barras', 'cod barras'], ejemplo: '7702049000017' },
  { campo: 'costo', titulos: ['costo', 'costo unitario', 'valor compra', 'precio compra', 'precio de compra'], ejemplo: 38000 },
  { campo: 'costos_variables', titulos: ['costos_variables', 'costos variables', 'flete', 'transporte'], ejemplo: 1500 },
  { campo: 'precio_venta', titulos: ['precio_venta', 'precio de venta', 'precio venta', 'precio', 'pvp', 'valor venta'], ejemplo: 52000 },
  { campo: 'margen_pct', titulos: ['margen_pct', 'margen', 'utilidad', '% utilidad', 'margen %', '% margen'], ejemplo: '' },
  { campo: 'existencias', titulos: ['existencias', 'stock', 'cantidad', 'inventario', 'unidades', 'saldo'], ejemplo: 24 },
  { campo: 'stock_min', titulos: ['stock_min', 'stock minimo', 'minimo', 'alerta', 'stock min'], ejemplo: 6 },
  { campo: 'es_pola', titulos: ['es_pola', 'pola'], ejemplo: 'no' },
  { campo: 'controla_vencimiento', titulos: ['controla_vencimiento', 'vence', 'vencimiento', 'perecedero', 'controla vencimiento'], ejemplo: 'no' },
]
const normal = (s: unknown) => String(s ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[_\s]+/g, ' ')
const money = (v: unknown) => (v === '' || v === undefined || v === null ? '—' : isNaN(Number(v)) ? String(v) : '$' + Math.round(Number(v)).toLocaleString('es-CO'))

interface Resultado { creados: number; actualizados: number; categorias_nuevas: number; errores: string[] }

export function ImportarCatalogo({ open, onClose, onListo }: { open: boolean; onClose: () => void; onListo: () => void }) {
  const [filas, setFilas] = useState<any[]>([])
  const [reconocidas, setReconocidas] = useState<string[]>([])
  const [ignoradas, setIgnoradas] = useState<string[]>([])
  const [archivo, setArchivo] = useState('')
  const [estado, setEstado] = useState<'inicio' | 'listo' | 'importando' | 'hecho'>('inicio')
  const [resultado, setResultado] = useState<Resultado | null>(null)
  const [error, setError] = useState<string | null>(null)

  function cerrar() {
    setFilas([]); setReconocidas([]); setIgnoradas([]); setArchivo(''); setEstado('inicio'); setResultado(null); setError(null)
    onClose()
  }

  async function leer(file: File) {
    setError(null)
    try {
      const XLSX = await import('xlsx')
      let wb
      if (/\.csv$/i.test(file.name)) {
        const texto = await file.text()
        const primera = texto.split(/\r?\n/)[0] ?? ''
        const sep = (primera.match(/;/g)?.length ?? 0) > (primera.match(/,/g)?.length ?? 0) ? ';' : ','
        wb = XLSX.read(texto, { type: 'string', FS: sep })
      } else {
        wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
      }
      const hoja = wb.Sheets[wb.SheetNames[0]]
      const crudas: any[] = XLSX.utils.sheet_to_json(hoja, { defval: '', raw: true })
      if (!crudas.length) throw new Error('La primera hoja está vacía')

      // Emparejar cada título del archivo con un campo del sistema.
      const mapa: Record<string, string> = {}
      const ign: string[] = []
      for (const t of Object.keys(crudas[0])) {
        const c = COLUMNAS.find((c) => c.titulos.map(normal).includes(normal(t)))
        if (c && !Object.values(mapa).includes(c.campo)) mapa[t] = c.campo
        else ign.push(t)
      }
      if (!Object.values(mapa).includes('nombre')) throw new Error('No encontré la columna del nombre del producto (título "nombre" o "producto").')
      const convertidas = crudas
        .map((r) => { const o: any = {}; for (const [t, c] of Object.entries(mapa)) o[c] = r[t]; return o })
        .filter((o) => String(o.nombre ?? '').trim())
      setFilas(convertidas); setReconocidas(Object.values(mapa)); setIgnoradas(ign); setArchivo(file.name); setEstado('listo')
    } catch (e: any) { setError(e.message ?? 'No se pudo leer el archivo') }
  }

  async function importar() {
    setEstado('importando'); setError(null)
    try {
      const r = await apiFetch<Resultado>('/api/productos/importar', { method: 'POST', body: JSON.stringify({ filas }) })
      setResultado(r); setEstado('hecho'); onListo()
    } catch (e: any) { setError(e.message); setEstado('listo') }
  }

  async function descargarPlantilla() {
    const XLSX = await import('xlsx')
    const hoja = XLSX.utils.aoa_to_sheet([COLUMNAS.map((c) => c.campo), COLUMNAS.map((c) => c.ejemplo)])
    hoja['!cols'] = COLUMNAS.map((c) => ({ wch: Math.max(14, c.campo.length + 2) }))
    const libro = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(libro, hoja, 'Productos')
    XLSX.writeFile(libro, 'plantilla-catalogo-liquor-express.xlsx')
  }

  return (
    <Modal open={open} title="Importar catálogo desde Excel" onClose={cerrar} ancho={640}>
      {estado === 'inicio' && (
        <div className="form" style={{ marginTop: 0 }}>
          <p className="muted" style={{ lineHeight: 1.55 }}>
            Sube el Excel con los productos. La primera fila debe tener los títulos; basta con la columna <b>nombre</b>.
            También reconoce: categoría, código de barras, costo, costos variables, precio de venta, margen, existencias, stock mínimo, POLA y vencimiento.
          </p>
          <button type="button" className="btn ghost" style={{ marginTop: 0 }} onClick={descargarPlantilla}>⬇ Descargar plantilla de ejemplo</button>
          <label className="btn" style={{ textAlign: 'center', cursor: 'pointer' }}>
            Elegir archivo (.xlsx, .xls o .csv)
            <input type="file" accept=".xlsx,.xls,.csv" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) leer(f); e.currentTarget.value = '' }} />
          </label>
          {error && <div className="alert">{error}</div>}
        </div>
      )}

      {(estado === 'listo' || estado === 'importando') && (
        <div>
          <p className="muted"><b>{archivo}</b> · {filas.length} producto(s) encontrados.</p>
          <div className="pos-chips" style={{ margin: '8px 0' }}>
            {reconocidas.map((c) => <span key={c} className="pos-chip" style={{ cursor: 'default' }}>✓ {c}</span>)}
          </div>
          {ignoradas.length > 0 && <p className="faint">Columnas que no se usan: {ignoradas.join(', ')}</p>}
          <div className="tabla-wrap" style={{ marginTop: 10, maxHeight: 260, overflowY: 'auto' }}>
            <table className="tabla" style={{ minWidth: 520 }}>
              <thead><tr><th>Nombre</th><th>Categoría</th><th className="num">Costo</th><th className="num">Precio</th><th className="num">Existencias</th></tr></thead>
              <tbody>
                {filas.slice(0, 50).map((f, i) => (
                  <tr key={i} style={{ cursor: 'default' }}>
                    <td>{String(f.nombre)}</td><td>{String(f.categoria ?? '') || <span className="faint">—</span>}</td>
                    <td className="num">{money(f.costo)}</td><td className="num">{money(f.precio_venta)}</td><td className="num">{String(f.existencias ?? '') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filas.length > 50 && <p className="faint" style={{ marginTop: 6 }}>Mostrando 50 de {filas.length}.</p>}
          <p className="faint" style={{ marginTop: 10 }}>Si un producto ya existe con el mismo nombre, se actualiza con los datos del archivo; los nuevos se crean. Las existencias quedan registradas en el kardex.</p>
          {error && <div className="alert" style={{ marginTop: 10 }}>{error}</div>}
          <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
            <button className="btn ghost" style={{ flex: 1, marginTop: 0 }} onClick={() => setEstado('inicio')} disabled={estado === 'importando'}>Elegir otro</button>
            <button className="btn" style={{ flex: 1, marginTop: 0 }} onClick={importar} disabled={estado === 'importando'}>
              {estado === 'importando' ? 'Importando…' : `Importar ${filas.length} producto(s)`}
            </button>
          </div>
        </div>
      )}

      {estado === 'hecho' && resultado && (
        <div>
          <div className="aviso-ok">
            {resultado.creados} producto(s) creados · {resultado.actualizados} actualizados{resultado.categorias_nuevas ? ` · ${resultado.categorias_nuevas} categoría(s) nuevas` : ''}
          </div>
          {resultado.errores.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <p className="muted">{resultado.errores.length} fila(s) con problemas:</p>
              <div style={{ maxHeight: 180, overflowY: 'auto', marginTop: 6 }}>
                {resultado.errores.slice(0, 100).map((e, i) => <div key={i} className="faint" style={{ fontSize: 12.5 }}>• {e}</div>)}
              </div>
            </div>
          )}
          <button className="btn" style={{ width: '100%', marginTop: 16 }} onClick={cerrar}>Listo</button>
        </div>
      )}
    </Modal>
  )
}
