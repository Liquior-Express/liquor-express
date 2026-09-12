'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { apiFetch } from '../../lib/api'
import { AppShell, useSesion } from '../../components/AppShell'
import { Modal } from '../../components/Modal'
import { useDialog } from '../../components/Dialog'
import { CostosOrigen, type ResumenCosto } from '../../components/CostosOrigen'
import { PresentacionesRapidas } from '../../components/PresentacionesRapidas'
import { ImportarCatalogo } from '../../components/ImportarCatalogo'
import { desglosar } from '../../lib/conversion'

interface Categoria { id: string; nombre: string }
interface Producto {
  id: string; nombre: string; categoria_id: string | null; categoria_nombre: string | null; codigo_barras: string | null
  unidad_base: string; costo?: number; costos_variables?: number; margen_pct?: number
  precio_venta: number; existencias: number; stock_min: number; foto_url: string | null
  es_pola: boolean; controla_vencimiento: boolean; vence_el: string | null; activo: boolean
}
interface Presentacion { id: string; producto_id?: string; nombre: string; factor_unidades: number; precio: number }
interface Movimiento { id: string; tipo: string; cantidad: number; referencia: string | null; creado_en: string }

const money = (n: number) => '$' + (Number(n) || 0).toLocaleString('es-CO', { maximumFractionDigits: 0 })
const hoyMas = (dias: number) => { const d = new Date(); d.setDate(d.getDate() + dias); return d }
const fechaCorta = (s: string) => new Date(s).toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: '2-digit' })
const TIPO_MOV: Record<string, string> = { entrada: 'Entrada', venta: 'Venta', merma: 'Merma', ajuste: 'Ajuste' }
const unidadCorta = (u: string) => (!u || u === 'unidad' ? 'und' : u)

// Reduce la imagen en el navegador antes de subirla (máx. 800 px, JPEG).
function comprimirImagen(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const max = 800
      const escala = Math.min(1, max / Math.max(img.width, img.height))
      const c = document.createElement('canvas')
      c.width = Math.round(img.width * escala); c.height = Math.round(img.height * escala)
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
      URL.revokeObjectURL(url)
      resolve(c.toDataURL('image/jpeg', 0.82))
    }
    img.onerror = reject
    img.src = url
  })
}

const vacio = {
  nombre: '', codigo_barras: '', categoria_id: '', unidad_base: 'unidad',
  costo: '', costos_variables: '', margen_pct: '30', precio_venta: '',
  existencias: '0', stock_min: '0', es_pola: false, controla_vencimiento: false, fecha_vencimiento: '',
}

export default function InventarioPage() {
  return <AppShell active="inventario" titulo="Inventario"><InventarioContenido /></AppShell>
}

function InventarioContenido() {
  const me = useSesion()
  const router = useRouter()
  const dialog = useDialog()
  const ve = me.ve_utilidad

  const [productos, setProductos] = useState<Producto[]>([])
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [todasPres, setTodasPres] = useState<Presentacion[]>([])
  const [buscar, setBuscar] = useState('')
  const [cargando, setCargando] = useState(true)
  const [editando, setEditando] = useState<Producto | 'nuevo' | null>(null)
  const [importando, setImportando] = useState(false)
  const [form, setForm] = useState({ ...vacio })
  const [msg, setMsg] = useState<string | null>(null)

  // Detalle del producto en edición.
  const [presentaciones, setPresentaciones] = useState<Presentacion[]>([])
  const [movimientos, setMovimientos] = useState<Movimiento[]>([])
  const [presForm, setPresForm] = useState({ nombre: '', factor_unidades: '', precio: '' })
  const [mermaForm, setMermaForm] = useState({ cantidad: '', motivo: 'vencido' })
  const [fotoUrl, setFotoUrl] = useState<string | null>(null)
  const [subiendo, setSubiendo] = useState(false)
  const [nOrigenes, setNOrigenes] = useState(0)
  const editId = editando && editando !== 'nuevo' ? editando.id : null

  // Caja no gestiona inventario.
  useEffect(() => { if (me.usuario.rol === 'cajero') router.replace('/ventas') }, [me, router])

  const cargar = useCallback(async () => {
    const [p, c, pr] = await Promise.all([
      apiFetch<{ productos: Producto[] }>('/api/productos'),
      apiFetch<{ categorias: Categoria[] }>('/api/categorias'),
      apiFetch<{ presentaciones: Presentacion[] }>('/api/presentaciones'),
    ])
    setProductos(p.productos); setCategorias(c.categorias); setTodasPres(pr.presentaciones)
  }, [])
  useEffect(() => { cargar().catch((e) => setMsg(e.message)).finally(() => setCargando(false)) }, [cargar])

  // ── Precio de venta autocalculado (costo + costos variables + margen) ──
  const base = (Number(form.costo) || 0) + (Number(form.costos_variables) || 0)
  const sugerido = base > 0 ? Math.round(base * (1 + (Number(form.margen_pct) || 0) / 100)) : 0

  function recalcularDesde(campo: 'costo' | 'costos_variables' | 'margen_pct', valor: string) {
    setForm((f) => {
      const nf = { ...f, [campo]: valor }
      const b = (Number(nf.costo) || 0) + (Number(nf.costos_variables) || 0)
      if (b > 0) nf.precio_venta = String(Math.round(b * (1 + (Number(nf.margen_pct) || 0) / 100)))
      return nf
    })
  }
  function cambiarPrecio(valor: string) {
    setForm((f) => {
      const b = (Number(f.costo) || 0) + (Number(f.costos_variables) || 0)
      const p = Number(valor) || 0
      return { ...f, precio_venta: valor, margen_pct: b > 0 ? String(Math.round(((p / b) - 1) * 100)) : f.margen_pct }
    })
  }

  function abrirNuevo() {
    setForm({ ...vacio }); setMsg(null); setPresentaciones([]); setMovimientos([]); setFotoUrl(null); setNOrigenes(0)
    setPresForm({ nombre: '', factor_unidades: '', precio: '' }); setMermaForm({ cantidad: '', motivo: 'vencido' })
    setEditando('nuevo')
  }
  async function abrirEditar(p: Producto) {
    setMsg(null); setNOrigenes(0)
    setForm({
      nombre: p.nombre, codigo_barras: p.codigo_barras ?? '', categoria_id: p.categoria_id ?? '', unidad_base: p.unidad_base,
      costo: p.costo != null ? String(p.costo) : '', costos_variables: p.costos_variables != null ? String(p.costos_variables) : '',
      margen_pct: p.margen_pct != null ? String(p.margen_pct) : '', precio_venta: String(p.precio_venta),
      existencias: String(p.existencias), stock_min: String(p.stock_min),
      es_pola: p.es_pola, controla_vencimiento: p.controla_vencimiento, fecha_vencimiento: p.vence_el ?? '',
    })
    setFotoUrl(p.foto_url); setPresForm({ nombre: '', factor_unidades: '', precio: '' }); setMermaForm({ cantidad: '', motivo: 'vencido' })
    setEditando(p)
    try {
      const [pr, mv] = await Promise.all([
        apiFetch<{ presentaciones: Presentacion[] }>(`/api/productos/${p.id}/presentaciones`),
        apiFetch<{ movimientos: Movimiento[] }>(`/api/productos/${p.id}/movimientos`),
      ])
      setPresentaciones(pr.presentaciones); setMovimientos(mv.movimientos)
    } catch { setPresentaciones([]); setMovimientos([]) }
  }

  // Los costos por origen recalculan el costo promedio del producto en el servidor.
  function alCambiarCostos(r: ResumenCosto) {
    setNOrigenes(r.n)
    if (r.costo !== undefined) {
      setForm((f) => ({ ...f, costo: String(r.costo), costos_variables: String(r.costos_variables ?? 0), margen_pct: String(r.margen_pct ?? f.margen_pct) }))
      cargar()
    }
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault(); setMsg(null)
    const cuerpo: any = {
      nombre: form.nombre, codigo_barras: form.codigo_barras, categoria_id: form.categoria_id || null, unidad_base: form.unidad_base,
      precio_venta: Number(form.precio_venta) || 0, existencias: Number(form.existencias) || 0,
      stock_min: Number(form.stock_min) || 0, es_pola: form.es_pola, controla_vencimiento: form.controla_vencimiento,
      fecha_vencimiento: form.controla_vencimiento ? (form.fecha_vencimiento || null) : null,
    }
    if (ve) {
      cuerpo.margen_pct = Number(form.margen_pct) || 0
      // Con costos por origen, el costo lo calcula el servidor (promedio): no se sobrescribe.
      if (nOrigenes === 0) { cuerpo.costo = Number(form.costo) || 0; cuerpo.costos_variables = Number(form.costos_variables) || 0 }
    }
    try {
      if (editando === 'nuevo') await apiFetch('/api/productos', { method: 'POST', body: JSON.stringify(cuerpo) })
      else await apiFetch(`/api/productos/${(editando as Producto).id}`, { method: 'PATCH', body: JSON.stringify(cuerpo) })
      setEditando(null); await cargar()
    } catch (e: any) {
      setMsg(String(e.message).includes('codigo_barras') ? 'Ese código de barras ya está en otro producto.' : (e.message ?? 'No se pudo guardar'))
    }
  }
  async function alternarActivo(p: Producto) {
    try { await apiFetch(`/api/productos/${p.id}`, { method: 'PATCH', body: JSON.stringify({ activo: !p.activo }) }); await cargar() }
    catch (e: any) { setMsg(e.message) }
  }
  async function borrarProducto() {
    if (!editId) return
    const ok = await dialog.confirmar({
      title: 'Borrar producto',
      message: `¿Borrar "${form.nombre}" del inventario? Se elimina con su foto, presentaciones, costos y movimientos. Si ya tiene ventas, no se puede borrar (desactívalo).`,
      confirmText: 'Borrar', peligro: true,
    })
    if (!ok) return
    try { await apiFetch(`/api/productos/${editId}`, { method: 'DELETE' }); setEditando(null); await cargar() }
    catch (e: any) { setMsg(e.message) }
  }
  async function nuevaCategoria() {
    const nombre = await dialog.pedir({ title: 'Nueva categoría', label: 'Nombre', placeholder: 'p. ej. Cervezas', confirmText: 'Crear' })
    if (!nombre) return
    try {
      const r = await apiFetch<{ categoria: Categoria }>('/api/categorias', { method: 'POST', body: JSON.stringify({ nombre }) })
      setCategorias((cs) => [...cs, r.categoria].sort((a, b) => a.nombre.localeCompare(b.nombre)))
      setForm((f) => ({ ...f, categoria_id: r.categoria.id }))
    } catch (e: any) { setMsg(e.message) }
  }

  async function subirFoto(file: File) {
    if (!editId) return
    setSubiendo(true); setMsg(null)
    try {
      const dataUrl = await comprimirImagen(file)
      const r = await apiFetch<{ foto_url: string }>(`/api/productos/${editId}/foto`, { method: 'POST', body: JSON.stringify({ foto: dataUrl }) })
      setFotoUrl(r.foto_url); cargar()
    } catch (e: any) { setMsg(e.message ?? 'No se pudo subir la foto') } finally { setSubiendo(false) }
  }
  async function quitarFoto() {
    if (!editId) return
    try { await apiFetch(`/api/productos/${editId}/foto`, { method: 'DELETE' }); setFotoUrl(null); cargar() } catch (e: any) { setMsg(e.message) }
  }
  async function agregarPresentacion(e: React.FormEvent) {
    e.preventDefault()
    if (!editId) return
    try {
      const r = await apiFetch<{ presentacion: Presentacion }>(`/api/productos/${editId}/presentaciones`, { method: 'POST', body: JSON.stringify(presForm) })
      setPresentaciones((ps) => [...ps, r.presentacion].sort((a, b) => b.factor_unidades - a.factor_unidades))
      setPresForm({ nombre: '', factor_unidades: '', precio: '' })
      cargar()
    } catch (e: any) { setMsg(e.message) }
  }
  async function borrarPresentacion(pid: string) {
    try { await apiFetch(`/api/presentaciones/${pid}`, { method: 'DELETE' }); setPresentaciones((ps) => ps.filter((x) => x.id !== pid)); cargar() }
    catch (e: any) { setMsg(e.message) }
  }
  async function registrarMerma(e: React.FormEvent) {
    e.preventDefault()
    if (!editId) return
    const ok = await dialog.confirmar({ title: 'Registrar merma', message: `Se descontarán ${mermaForm.cantidad} unidad(es) por "${mermaForm.motivo}". ¿Confirmar?`, confirmText: 'Registrar', peligro: true })
    if (!ok) return
    try {
      await apiFetch(`/api/productos/${editId}/merma`, { method: 'POST', body: JSON.stringify(mermaForm) })
      setMermaForm({ cantidad: '', motivo: 'vencido' })
      setMsg('Merma registrada')
      const p = productos.find((x) => x.id === editId)
      if (p) await abrirEditar({ ...p })
      cargar()
    } catch (e: any) { setMsg(e.message) }
  }

  const presDe = (id: string) => todasPres.filter((x) => x.producto_id === id)
  const filtrados = useMemo(() => {
    const q = buscar.trim().toLowerCase()
    return productos.filter((p) => !q || p.nombre.toLowerCase().includes(q) || (p.categoria_nombre ?? '').toLowerCase().includes(q) || (p.codigo_barras ?? '').includes(q))
  }, [productos, buscar])

  if (cargando) return <p className="muted">Cargando inventario…</p>

  const desgloseForm = desglosar(Number(form.existencias), presentaciones, unidadCorta(form.unidad_base))

  return (
    <>
      <div className="toolbar">
        <input className="buscar" placeholder="Buscar por nombre, categoría o código…" value={buscar} onChange={(e) => setBuscar(e.target.value)} />
        <button className="btn ghost" style={{ marginTop: 0 }} onClick={() => setImportando(true)}>⬆ Importar Excel</button>
        <button className="btn" style={{ marginTop: 0 }} onClick={abrirNuevo}>＋ Nuevo producto</button>
      </div>
      {msg && !editando && <div className="alert" style={{ marginBottom: 12 }}>{msg}</div>}

      <div className="tabla-wrap">
        <table className="tabla">
          <thead>
            <tr>
              <th>Producto</th>
              <th className="num">Existencias</th>
              {ve && <th className="num">Costo</th>}
              <th className="num">Precio</th>
              {ve && <th className="num">Margen</th>}
              <th style={{ width: 40 }}></th>
            </tr>
          </thead>
          <tbody>
            {filtrados.map((p) => {
              const bajo = p.stock_min > 0 && p.existencias <= p.stock_min
              const vencido = p.vence_el && new Date(p.vence_el) < new Date()
              const porVencer = p.vence_el && !vencido && new Date(p.vence_el) <= hoyMas(30)
              const desg = desglosar(p.existencias, presDe(p.id), unidadCorta(p.unidad_base))
              return (
                <tr key={p.id} className={p.activo ? '' : 'inactivo'} onClick={() => abrirEditar(p)}>
                  <td>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      {p.foto_url ? <img src={p.foto_url} alt="" className="miniatura" /> : <span className="miniatura vacia">🍾</span>}
                      <span>
                        {p.nombre}
                        {p.categoria_nombre && <span className="faint"> · {p.categoria_nombre}</span>}
                        {p.es_pola && <span className="sello-pola">POLA</span>}
                        {vencido && <span className="chip warn">Vencido</span>}
                        {porVencer && <span className="chip vence">Por vencer</span>}
                        {!p.activo && <span className="faint"> (inactivo)</span>}
                        {p.codigo_barras && <span className="desglose">▥ {p.codigo_barras}</span>}
                      </span>
                    </span>
                  </td>
                  <td className="num">
                    {p.existencias} {unidadCorta(p.unidad_base)}{bajo && <span className="chip warn">Bajo</span>}
                    {desg && <span className="desglose">{desg}</span>}
                  </td>
                  {ve && <td className="num">{money(p.costo ?? 0)}</td>}
                  <td className="num">{money(p.precio_venta)}</td>
                  {ve && <td className="num">{p.margen_pct != null ? `${p.margen_pct}%` : '—'}</td>}
                  <td onClick={(e) => { e.stopPropagation(); alternarActivo(p) }}>
                    <button className="link-btn" title={p.activo ? 'Desactivar' : 'Activar'}>{p.activo ? '⏸' : '▶'}</button>
                  </td>
                </tr>
              )
            })}
            {filtrados.length === 0 && (
              <tr><td colSpan={ve ? 6 : 4} style={{ textAlign: 'center', color: 'var(--faint)', padding: 24 }}>
                {productos.length === 0 ? 'Aún no hay productos. Crea el primero o importa el Excel.' : 'Sin resultados.'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="faint" style={{ marginTop: 12 }}>{filtrados.length} producto(s){!ve && ' · el costo y la utilidad solo los ve Admin/Gerencia'}</p>

      <ImportarCatalogo open={importando} onClose={() => setImportando(false)} onListo={() => { cargar() }} />

      <Modal open={!!editando} title={editando === 'nuevo' ? 'Nuevo producto' : 'Editar producto'} onClose={() => setEditando(null)} ancho={580}>
        <form className="form" style={{ marginTop: 0 }} onSubmit={guardar}>
          <div className="field"><label>Nombre</label>
            <input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} required /></div>

          <div className="field"><label>Código de barras (opcional)</label>
            <input value={form.codigo_barras} placeholder="Escanéalo con el lector o escríbelo" onChange={(e) => setForm({ ...form, codigo_barras: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault() /* el lector envía Enter: no guardar todavía */ }} /></div>

          <div className="field"><label>Categoría</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <select value={form.categoria_id} onChange={(e) => setForm({ ...form, categoria_id: e.target.value })}>
                <option value="">(sin categoría)</option>
                {categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
              <button type="button" className="btn ghost" style={{ marginTop: 0, padding: '0 14px' }} onClick={nuevaCategoria}>＋</button>
            </div>
          </div>

          {ve && (
            <div className="grid2">
              <div className="field"><label>Costo {nOrigenes > 0 && <span className="faint">(promedio de {nOrigenes} origen{nOrigenes > 1 ? 'es' : ''})</span>}</label>
                <input type="number" inputMode="numeric" value={form.costo} readOnly={nOrigenes > 0} onChange={(e) => recalcularDesde('costo', e.target.value)} /></div>
              <div className="field"><label>Costos variables</label>
                <input type="number" inputMode="numeric" value={form.costos_variables} readOnly={nOrigenes > 0} onChange={(e) => recalcularDesde('costos_variables', e.target.value)} /></div>
            </div>
          )}

          <div className="grid2">
            {ve && (
              <div className="field"><label>Margen %</label>
                <input type="number" inputMode="numeric" value={form.margen_pct} onChange={(e) => recalcularDesde('margen_pct', e.target.value)} /></div>
            )}
            <div className="field"><label>Precio de venta {ve && <span className="faint">(autocalculado, editable)</span>}</label>
              <input type="number" inputMode="numeric" value={form.precio_venta} onChange={(e) => cambiarPrecio(e.target.value)} required /></div>
          </div>
          {ve && base > 0 && <div className="sugerido">Con {form.margen_pct || 0}% → sugerido <b>{money(sugerido)}</b> (base {money(base)})</div>}

          <div className="grid2">
            <div className="field"><label>Existencias (unidades)</label>
              <input type="number" inputMode="numeric" value={form.existencias} onChange={(e) => setForm({ ...form, existencias: e.target.value })} />
              {desgloseForm && <div className="sugerido">= {desgloseForm}</div>}</div>
            <div className="field"><label>Alerta stock bajo (≤)</label>
              <input type="number" inputMode="numeric" value={form.stock_min} onChange={(e) => setForm({ ...form, stock_min: e.target.value })} /></div>
          </div>

          <label className="check"><input type="checkbox" checked={form.es_pola} onChange={(e) => setForm({ ...form, es_pola: e.target.checked })} /> Producto <b>POLA</b> (surtido por el bar)</label>
          <label className="check"><input type="checkbox" checked={form.controla_vencimiento} onChange={(e) => setForm({ ...form, controla_vencimiento: e.target.checked })} /> Controla <b>vencimiento</b></label>

          {form.controla_vencimiento && (
            <div className="field"><label>Fecha de vencimiento</label>
              <input type="date" value={form.fecha_vencimiento} onChange={(e) => setForm({ ...form, fecha_vencimiento: e.target.value })} />
              <div className="sugerido">Cuando llegue más de este producto, la fecha y la factura se registran en Compras.</div>
            </div>
          )}

          {msg && <div className="alert">{msg}</div>}
          <button className="btn" type="submit">{editando === 'nuevo' ? 'Crear producto' : 'Guardar cambios'}</button>
        </form>

        {editando === 'nuevo' && (
          <p className="faint" style={{ marginTop: 14 }}>Guarda el producto para agregar foto, presentaciones, costos por origen y mermas.</p>
        )}

        {editId && (
          <div style={{ marginTop: 8 }}>
            {ve && (
              <>
                <div className="sep-modal" />
                <h4 className="sub-modal">Costo por origen <span className="faint" style={{ fontWeight: 400 }}>(Colombia / Brasil · mismo precio, distinta utilidad)</span></h4>
                <CostosOrigen productoId={editId} precioVenta={Number(form.precio_venta) || 0} onCambio={alCambiarCostos} />
              </>
            )}

            <div className="sep-modal" />
            <h4 className="sub-modal">Foto</h4>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              {fotoUrl ? <img src={fotoUrl} alt="" className="foto-prod" /> : <span className="foto-prod vacia">🍾</span>}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label className="btn ghost" style={{ marginTop: 0, cursor: 'pointer', textAlign: 'center' }}>
                  {subiendo ? 'Subiendo…' : (fotoUrl ? 'Cambiar foto' : 'Subir foto')}
                  <input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) subirFoto(f); e.currentTarget.value = '' }} />
                </label>
                {fotoUrl && <button type="button" className="link-btn" onClick={quitarFoto}>Quitar foto</button>}
              </div>
            </div>

            <div className="sep-modal" />
            <h4 className="sub-modal">Presentaciones <span className="faint" style={{ fontWeight: 400 }}>(caja, six, cartón, cajetilla…)</span></h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
              {presentaciones.map((pr) => (
                <div key={pr.id} className="row-between" style={{ fontSize: 13.5 }}>
                  <span>{pr.nombre} <span className="faint">· {pr.factor_unidades} und · {money(pr.precio)}</span></span>
                  <button type="button" className="link-btn" title="Quitar" onClick={() => borrarPresentacion(pr.id)}>✕</button>
                </div>
              ))}
              {presentaciones.length === 0 && <span className="faint">Sin presentaciones. Se vende por {form.unidad_base}.</span>}
            </div>
            <form onSubmit={agregarPresentacion} style={{ display: 'grid', gridTemplateColumns: '1fr 84px 96px auto', gap: 8, alignItems: 'end' }}>
              <div className="field"><label>Nombre</label><input value={presForm.nombre} placeholder="Caja" onChange={(e) => setPresForm({ ...presForm, nombre: e.target.value })} required /></div>
              <div className="field"><label>Unidades</label><input type="number" inputMode="numeric" value={presForm.factor_unidades} placeholder="30" onChange={(e) => setPresForm({ ...presForm, factor_unidades: e.target.value })} required /></div>
              <div className="field"><label>Precio</label><input type="number" inputMode="numeric" value={presForm.precio} onChange={(e) => setPresForm({ ...presForm, precio: e.target.value })} /></div>
              <button className="btn" type="submit" style={{ marginTop: 0, padding: '0 14px', height: 42 }}>＋</button>
            </form>

            <PresentacionesRapidas
              productoId={editId}
              precioUnidad={Number(form.precio_venta) || 0}
              presentaciones={presentaciones}
              setPresentaciones={(ps) => { setPresentaciones(ps); cargar() }}
              onExistencias={(n) => { setForm((f) => ({ ...f, existencias: String(n) })); cargar() }}
            />

            <div className="sep-modal" />
            <h4 className="sub-modal">Registrar merma</h4>
            <form onSubmit={registrarMerma} style={{ display: 'grid', gridTemplateColumns: '96px 1fr auto', gap: 8, alignItems: 'end' }}>
              <div className="field"><label>Cantidad</label><input type="number" inputMode="numeric" value={mermaForm.cantidad} onChange={(e) => setMermaForm({ ...mermaForm, cantidad: e.target.value })} required /></div>
              <div className="field"><label>Motivo</label>
                <select value={mermaForm.motivo} onChange={(e) => setMermaForm({ ...mermaForm, motivo: e.target.value })}>
                  <option value="vencido">Vencido</option><option value="faltante">Faltante</option><option value="averia">Avería</option>
                </select>
              </div>
              <button className="btn peligro" type="submit" style={{ marginTop: 0, padding: '0 14px', height: 42 }}>Registrar</button>
            </form>

            <div className="sep-modal" />
            <h4 className="sub-modal">Movimientos (kardex)</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 180, overflowY: 'auto' }}>
              {movimientos.map((m) => (
                <div key={m.id} className="row-between" style={{ fontSize: 12.5 }}>
                  <span>{TIPO_MOV[m.tipo] ?? m.tipo} {m.referencia && <span className="faint">· {m.referencia}</span>}</span>
                  <span><b style={{ color: m.cantidad < 0 ? 'var(--copper)' : 'var(--teal)' }}>{m.cantidad > 0 ? '+' : ''}{m.cantidad}</b> <span className="faint">{fechaCorta(m.creado_en)}</span></span>
                </div>
              ))}
              {movimientos.length === 0 && <span className="faint">Sin movimientos.</span>}
            </div>

            <div className="sep-modal" />
            <button type="button" className="btn peligro" style={{ width: '100%', marginTop: 0 }} onClick={borrarProducto}>🗑 Borrar producto</button>
          </div>
        )}
      </Modal>
    </>
  )
}
