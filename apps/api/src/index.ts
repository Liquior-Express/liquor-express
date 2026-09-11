import './env.ts'
import express from 'express'
import cors from 'cors'
import { supabase, hayBD } from './supabase.ts'
import {
  autenticar, requiereRol, veUtilidad, firmarToken, hashClave, verificarClave,
  COLS_USUARIO, type Rol,
} from './auth.ts'

const app = express()
app.use(cors())
app.use(express.json())

const ROLES: Rol[] = ['cajero', 'admin', 'gerencia']
const MIN_CLAVE = 4

const db = () => supabase!

// Registra una acción sensible en la bitácora (no interrumpe el flujo).
async function auditar(usuarioId: string, accion: string, entidad?: string, entidadId?: string, detalle?: unknown) {
  if (!supabase) return
  try {
    await supabase.from('auditoria').insert({ usuario_id: usuarioId, accion, entidad, entidad_id: entidadId, detalle: detalle ?? null })
  } catch { /* la auditoría nunca tumba la operación principal */ }
}

// ── Salud (pública) ─────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, servicio: 'liquor-express-api', bd: hayBD() ? 'conectada' : 'sin configurar' })
})

// ── Estado de arranque: ¿ya existe el primer administrador? ──
app.get('/api/auth/estado', async (_req, res) => {
  if (!supabase) return res.status(503).json({ error: 'Base de datos no configurada' })
  const { count, error } = await db().from('usuarios').select('id', { count: 'exact', head: true }).eq('rol', 'admin').eq('activo', true)
  if (error) return res.status(500).json({ error: error.message })
  res.json({ inicializado: (count ?? 0) > 0 })
})

// ── Arranque: crear el PRIMER admin (solo si no hay ninguno) ─
app.post('/api/auth/bootstrap', async (req, res) => {
  if (!supabase) return res.status(503).json({ error: 'Base de datos no configurada' })
  const { usuario, nombre, password } = req.body ?? {}
  if (!usuario || !password) return res.status(400).json({ error: 'Usuario y contraseña son obligatorios' })
  if (String(password).length < MIN_CLAVE) return res.status(400).json({ error: `La contraseña debe tener al menos ${MIN_CLAVE} caracteres` })

  const { count } = await db().from('usuarios').select('id', { count: 'exact', head: true }).eq('rol', 'admin').eq('activo', true)
  if ((count ?? 0) > 0) return res.status(403).json({ error: 'El sistema ya tiene administrador' })

  const password_hash = await hashClave(String(password))
  const { data, error } = await db().from('usuarios')
    .insert({ usuario: String(usuario).trim(), nombre: (nombre?.trim() || String(usuario).trim()), rol: 'admin', password_hash })
    .select(COLS_USUARIO).single()
  if (error) return res.status(500).json({ error: error.message })

  await auditar(data.id, 'crear_usuario', 'usuarios', data.id, { rol: 'admin', arranque: true })
  res.status(201).json({ token: firmarToken(data.id), usuario: data, ve_utilidad: true })
})

// ── Iniciar sesión (usuario + contraseña) ───────────────────
app.post('/api/auth/login', async (req, res) => {
  if (!supabase) return res.status(503).json({ error: 'Base de datos no configurada' })
  const { usuario, password } = req.body ?? {}
  if (!usuario || !password) return res.status(400).json({ error: 'Usuario y contraseña son obligatorios' })

  // Tabla pequeña: se compara en memoria sin distinguir mayúsculas (evita los comodines de ilike: % _ *).
  const { data: lista, error: errU } = await db().from('usuarios')
    .select('id, usuario, nombre, rol, activo, password_hash')
  if (errU) return res.status(503).json({ error: 'No se pudo conectar con la base de datos. Intenta de nuevo.' })
  const buscado = String(usuario).trim().toLowerCase()
  const u = (lista ?? []).find((x) => String(x.usuario ?? '').toLowerCase() === buscado)

  const ok = u && u.activo && u.password_hash && await verificarClave(String(password), u.password_hash)
  if (!ok) return res.status(401).json({ error: 'Usuario o contraseña incorrectos' })

  const limpio = { id: u!.id, usuario: u!.usuario, nombre: u!.nombre, rol: u!.rol as Rol, activo: u!.activo }
  res.json({ token: firmarToken(u!.id), usuario: limpio, ve_utilidad: veUtilidad(limpio.rol) })
})

// ── Quién soy ───────────────────────────────────────────────
app.get('/api/auth/me', autenticar, (req, res) => {
  const u = req.usuario!
  res.json({ usuario: u, ve_utilidad: veUtilidad(u.rol) })
})

// ── Gestión de usuarios (solo admin/gerencia) ───────────────
app.get('/api/usuarios', autenticar, requiereRol('admin', 'gerencia'), async (_req, res) => {
  const { data, error } = await db().from('usuarios').select(COLS_USUARIO).order('creado_en')
  if (error) return res.status(500).json({ error: error.message })
  res.json({ usuarios: data })
})

app.post('/api/usuarios', autenticar, requiereRol('admin', 'gerencia'), async (req, res) => {
  const { usuario, nombre, password, rol } = req.body ?? {}
  if (!usuario || !password || !rol) return res.status(400).json({ error: 'Usuario, contraseña y rol son obligatorios' })
  if (!ROLES.includes(rol)) return res.status(400).json({ error: `Rol inválido. Usa: ${ROLES.join(', ')}` })
  if (String(password).length < MIN_CLAVE) return res.status(400).json({ error: `La contraseña debe tener al menos ${MIN_CLAVE} caracteres` })

  const password_hash = await hashClave(String(password))
  const { data, error } = await db().from('usuarios')
    .insert({ usuario: String(usuario).trim(), nombre: (nombre?.trim() || String(usuario).trim()), rol, password_hash })
    .select(COLS_USUARIO).single()

  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: `Ya existe un usuario "${usuario}"` })
    return res.status(500).json({ error: error.message })
  }
  await auditar(req.usuario!.id, 'crear_usuario', 'usuarios', data.id, { usuario: data.usuario, rol })
  res.status(201).json({ usuario: data })
})

// Editar: activar/desactivar, cambiar rol, o restablecer contraseña.
app.patch('/api/usuarios/:id', autenticar, requiereRol('admin', 'gerencia'), async (req, res) => {
  const { id } = req.params
  const cambios: Record<string, unknown> = {}
  if (typeof req.body?.activo === 'boolean') cambios.activo = req.body.activo
  if (req.body?.rol) {
    if (!ROLES.includes(req.body.rol)) return res.status(400).json({ error: 'Rol inválido' })
    cambios.rol = req.body.rol
  }
  if (req.body?.nombre) cambios.nombre = String(req.body.nombre).trim()
  if (req.body?.password) {
    if (String(req.body.password).length < MIN_CLAVE) return res.status(400).json({ error: `La contraseña debe tener al menos ${MIN_CLAVE} caracteres` })
    cambios.password_hash = await hashClave(String(req.body.password))
  }
  if (Object.keys(cambios).length === 0) return res.status(400).json({ error: 'Nada que actualizar' })

  // No permitir que alguien se quite a sí mismo el acceso (activo/rol).
  if (id === req.usuario!.id && (cambios.activo === false || (cambios.rol && cambios.rol !== 'admin' && cambios.rol !== 'gerencia'))) {
    return res.status(400).json({ error: 'No puedes retirarte tu propio acceso de gestión' })
  }

  const { data, error } = await db().from('usuarios').update(cambios).eq('id', id).select(COLS_USUARIO).single()
  if (error) return res.status(500).json({ error: error.message })
  const { password_hash, ...detalle } = cambios as any
  await auditar(req.usuario!.id, 'editar_usuario', 'usuarios', id, { ...detalle, clave_cambiada: !!password_hash })
  res.json({ usuario: data })
})

app.delete('/api/usuarios/:id', autenticar, requiereRol('admin', 'gerencia'), async (req, res) => {
  const { id } = req.params
  if (id === req.usuario!.id) return res.status(400).json({ error: 'No puedes eliminar tu propio usuario' })

  // No dejar el sistema sin administradores activos.
  const { data: obj } = await db().from('usuarios').select('rol, activo').eq('id', id).single()
  if (obj?.rol === 'admin' && obj.activo) {
    const { count } = await db().from('usuarios').select('id', { count: 'exact', head: true }).eq('rol', 'admin').eq('activo', true)
    if ((count ?? 0) <= 1) return res.status(400).json({ error: 'Debe quedar al menos un administrador' })
  }

  const { error } = await db().from('usuarios').delete().eq('id', id)
  if (error) return res.status(500).json({ error: error.message })
  await auditar(req.usuario!.id, 'eliminar_usuario', 'usuarios', id)
  res.json({ ok: true })
})

// ── Categorías ──────────────────────────────────────────────
app.get('/api/categorias', autenticar, async (_req, res) => {
  const { data, error } = await db().from('categorias').select('id, nombre').order('nombre')
  if (error) return res.status(500).json({ error: error.message })
  res.json({ categorias: data })
})

app.post('/api/categorias', autenticar, requiereRol('admin', 'gerencia'), async (req, res) => {
  const nombre = String(req.body?.nombre ?? '').trim()
  if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio' })
  const { data, error } = await db().from('categorias').insert({ nombre }).select('id, nombre').single()
  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: `Ya existe la categoría "${nombre}"` })
    return res.status(500).json({ error: error.message })
  }
  res.status(201).json({ categoria: data })
})

// ── Productos ───────────────────────────────────────────────
// Campos de costo/utilidad se ocultan a Caja (solo admin/gerencia los ven).
const CAMPOS_SENSIBLES = ['costo', 'costos_variables', 'margen_pct'] as const

function filtrarSegunRol<T extends Record<string, any>>(prod: T, ve: boolean): T {
  if (ve) return prod
  const copia: any = { ...prod }
  for (const c of CAMPOS_SENSIBLES) delete copia[c]
  return copia
}

app.get('/api/productos', autenticar, async (req, res) => {
  const { data, error } = await db()
    .from('productos')
    .select('*, categoria:categorias(nombre), lotes(fecha_vencimiento, cantidad)')
    .order('nombre')
  if (error) return res.status(500).json({ error: error.message })

  const ve = veUtilidad(req.usuario!.rol)
  const productos = (data ?? []).map((p: any) => {
    const { categoria, lotes, ...resto } = p
    // Vencimiento más cercano entre los lotes que todavía tienen unidades.
    const fechas = (lotes ?? []).filter((l: any) => l.fecha_vencimiento && Number(l.cantidad) > 0).map((l: any) => l.fecha_vencimiento).sort()
    return filtrarSegunRol({ ...resto, categoria_nombre: categoria?.nombre ?? null, vence_el: fechas[0] ?? null }, ve)
  })
  res.json({ fuente: 'supabase', productos })
})

import { descontarLotes } from './rutas/comun.ts'

// Lote "manual" (sin compra) con la fecha puesta desde Inventario: cubre las unidades que
// no vienen de una compra registrada. Los lotes de las compras no se tocan.
async function sincronizarLote(productoId: string, fecha: string | null, cantidad?: number, costo?: number) {
  if (!fecha) return
  const { data: deCompras } = await db().from('lotes').select('cantidad').eq('producto_id', productoId).not('compra_id', 'is', null)
  const enCompras = (deCompras ?? []).reduce((s: number, l: any) => s + Number(l.cantidad || 0), 0)
  const cant = Math.max(0, (cantidad ?? 0) - enCompras)
  const { data: existente } = await db().from('lotes').select('id').eq('producto_id', productoId).is('compra_id', null).limit(1).maybeSingle()
  if (existente) {
    await db().from('lotes').update({ fecha_vencimiento: fecha, cantidad: cant, costo_lote: costo ?? null }).eq('id', existente.id)
  } else {
    await db().from('lotes').insert({ producto_id: productoId, fecha_vencimiento: fecha, cantidad: cant, costo_lote: costo ?? null })
  }
}

// Registra un movimiento en el kardex (no interrumpe el flujo).
async function registrarMovimiento(productoId: string, tipo: 'entrada' | 'venta' | 'merma' | 'ajuste', cantidad: number, usuarioId: string, referencia?: string) {
  if (!supabase) return
  try { await db().from('movimientos_inventario').insert({ producto_id: productoId, tipo, cantidad, usuario_id: usuarioId, referencia }) } catch {}
}

// Campos editables/creables de un producto.
function saneaProducto(body: any) {
  const p: Record<string, unknown> = {}
  if (body.nombre !== undefined) p.nombre = String(body.nombre).trim()
  if (body.categoria_id !== undefined) p.categoria_id = body.categoria_id || null
  if (body.unidad_base !== undefined) p.unidad_base = String(body.unidad_base).trim() || 'unidad'
  for (const n of ['costo', 'costos_variables', 'margen_pct', 'precio_venta', 'existencias', 'stock_min']) {
    if (body[n] !== undefined && body[n] !== null && body[n] !== '') p[n] = Number(body[n])
  }
  if (body.es_pola !== undefined) p.es_pola = !!body.es_pola
  if (body.controla_vencimiento !== undefined) p.controla_vencimiento = !!body.controla_vencimiento
  if (typeof body.activo === 'boolean') p.activo = body.activo
  return p
}

app.post('/api/productos', autenticar, requiereRol('admin', 'gerencia'), async (req, res) => {
  const p = saneaProducto(req.body ?? {})
  if (!p.nombre) return res.status(400).json({ error: 'El nombre del producto es obligatorio' })
  const { data, error } = await db().from('productos').insert(p).select('*').single()
  if (error) return res.status(500).json({ error: error.message })
  if (data.controla_vencimiento && req.body?.fecha_vencimiento) {
    await sincronizarLote(data.id, req.body.fecha_vencimiento, data.existencias, data.costo)
  }
  if (Number(data.existencias) > 0) await registrarMovimiento(data.id, 'entrada', Number(data.existencias), req.usuario!.id, 'alta de producto')
  await auditar(req.usuario!.id, 'crear_producto', 'productos', data.id, { nombre: data.nombre })
  res.status(201).json({ producto: data })
})

app.patch('/api/productos/:id', autenticar, requiereRol('admin', 'gerencia'), async (req, res) => {
  const { id } = req.params
  const p = saneaProducto(req.body ?? {})
  if (Object.keys(p).length === 0) return res.status(400).json({ error: 'Nada que actualizar' })

  // Existencias previas para registrar el ajuste en el kardex.
  let prevExist: number | null = null
  if (p.existencias !== undefined) {
    const { data: cur } = await db().from('productos').select('existencias').eq('id', id).single()
    prevExist = cur ? Number(cur.existencias) : null
  }

  const { data, error } = await db().from('productos').update(p).eq('id', id).select('*').single()
  if (error) return res.status(500).json({ error: error.message })

  if (req.body?.fecha_vencimiento !== undefined && data.controla_vencimiento) {
    await sincronizarLote(id, req.body.fecha_vencimiento, data.existencias, data.costo)
  }
  if (prevExist !== null && Number(p.existencias) !== prevExist) {
    await registrarMovimiento(id, 'ajuste', Number(p.existencias) - prevExist, req.usuario!.id, 'ajuste manual')
  }

  // Auditar cambios sensibles de precio/costo.
  if (p.precio_venta !== undefined || p.costo !== undefined || p.margen_pct !== undefined) {
    await auditar(req.usuario!.id, 'cambiar_precio', 'productos', id, {
      precio_venta: p.precio_venta, costo: p.costo, margen_pct: p.margen_pct,
    })
  }
  res.json({ producto: data })
})

// ── Presentaciones (fraccionamiento: caja / six / cartón / cajetilla / unidad) ──
app.get('/api/productos/:id/presentaciones', autenticar, async (req, res) => {
  const { data, error } = await db().from('presentaciones').select('id, nombre, factor_unidades, precio').eq('producto_id', req.params.id).order('factor_unidades', { ascending: false })
  if (error) return res.status(500).json({ error: error.message })
  res.json({ presentaciones: data })
})

app.post('/api/productos/:id/presentaciones', autenticar, requiereRol('admin', 'gerencia'), async (req, res) => {
  const { nombre, factor_unidades, precio } = req.body ?? {}
  if (!nombre || !factor_unidades) return res.status(400).json({ error: 'Nombre y factor son obligatorios' })
  const { data, error } = await db().from('presentaciones')
    .insert({ producto_id: req.params.id, nombre: String(nombre).trim(), factor_unidades: Number(factor_unidades), precio: Number(precio) || 0 })
    .select('id, nombre, factor_unidades, precio').single()
  if (error) return res.status(500).json({ error: error.message })
  res.status(201).json({ presentacion: data })
})

app.delete('/api/presentaciones/:pid', autenticar, requiereRol('admin', 'gerencia'), async (req, res) => {
  const { error } = await db().from('presentaciones').delete().eq('id', req.params.pid)
  if (error) return res.status(500).json({ error: error.message })
  res.json({ ok: true })
})

// ── Kardex (movimientos de inventario) ──────────────────────
app.get('/api/productos/:id/movimientos', autenticar, async (req, res) => {
  const { data, error } = await db().from('movimientos_inventario')
    .select('id, tipo, cantidad, referencia, creado_en').eq('producto_id', req.params.id)
    .order('creado_en', { ascending: false }).limit(50)
  if (error) return res.status(500).json({ error: error.message })
  res.json({ movimientos: data })
})

// ── Mermas (bajas con motivo) ───────────────────────────────
app.post('/api/productos/:id/merma', autenticar, requiereRol('admin', 'gerencia'), async (req, res) => {
  const { id } = req.params
  const cantidad = Number(req.body?.cantidad)
  const motivo = req.body?.motivo
  if (!cantidad || cantidad <= 0) return res.status(400).json({ error: 'Cantidad inválida' })
  if (!['vencido', 'faltante', 'averia'].includes(motivo)) return res.status(400).json({ error: 'Motivo inválido' })

  const { data: prod } = await db().from('productos').select('existencias').eq('id', id).single()
  if (!prod) return res.status(404).json({ error: 'Producto no encontrado' })
  const nueva = Number(prod.existencias) - cantidad

  await db().from('mermas').insert({ producto_id: id, cantidad, motivo, usuario_id: req.usuario!.id })
  const { error } = await db().from('productos').update({ existencias: nueva }).eq('id', id)
  if (error) return res.status(500).json({ error: error.message })
  await descontarLotes(db, id, cantidad) // la merma sale del lote que vence primero
  await registrarMovimiento(id, 'merma', -cantidad, req.usuario!.id, motivo)
  await auditar(req.usuario!.id, 'merma', 'productos', id, { cantidad, motivo })
  res.json({ ok: true, existencias: nueva })
})

// ── Foto del producto (Supabase Storage, bucket público `productos`) ──
app.post('/api/productos/:id/foto', autenticar, requiereRol('admin', 'gerencia'), async (req, res) => {
  const m = /^data:(image\/(png|jpe?g|webp));base64,(.+)$/i.exec(req.body?.foto ?? '')
  if (!m) return res.status(400).json({ error: 'Imagen inválida' })
  const contentType = m[1].toLowerCase()
  const ext = /jpe?g/i.test(m[2]) ? 'jpg' : m[2].toLowerCase()
  const buffer = Buffer.from(m[3], 'base64')
  if (buffer.length > 3_000_000) return res.status(400).json({ error: 'La imagen supera 3 MB' })

  const ruta = `${req.params.id}.${ext}`
  const { error: errUp } = await db().storage.from('productos').upload(ruta, buffer, { contentType, upsert: true })
  if (errUp) return res.status(500).json({ error: errUp.message })
  const { data: pub } = db().storage.from('productos').getPublicUrl(ruta)
  const foto_url = `${pub.publicUrl}?v=${Date.now()}`
  const { error } = await db().from('productos').update({ foto_url }).eq('id', req.params.id)
  if (error) return res.status(500).json({ error: error.message })
  res.json({ foto_url })
})

app.delete('/api/productos/:id/foto', autenticar, requiereRol('admin', 'gerencia'), async (req, res) => {
  await db().storage.from('productos').remove([`${req.params.id}.jpg`, `${req.params.id}.png`, `${req.params.id}.webp`])
  await db().from('productos').update({ foto_url: null }).eq('id', req.params.id)
  res.json({ ok: true })
})

// Mejoras Sprint 1: presencia, borrar producto, costos por origen, tasa del Real y ventas rápidas.
import { registrarExtras } from './rutas/extras.ts'
registrarExtras(app, { db, auditar, registrarMovimiento })

// Sprint 2: ventas rápidas + caja (apertura, entradas/salidas, cierre en pesos y reales).
import { registrarVentasYCaja } from './rutas/ventas.ts'
registrarVentasYCaja(app, { db, auditar, registrarMovimiento })

// Sprint 2: compras y proveedores; gastos, caja menor y flujo de caja.
import { registrarCompras } from './rutas/compras.ts'
import { registrarGastos } from './rutas/gastos.ts'
registrarCompras(app, { db, auditar, registrarMovimiento })
registrarGastos(app, { db, auditar })

// Crea el bucket de fotos si no existe (idempotente).
async function asegurarBucket() {
  if (!supabase) return
  try {
    const { data } = await db().storage.getBucket('productos')
    if (!data) await db().storage.createBucket('productos', { public: true })
  } catch { /* si ya existe u otro caso, se ignora */ }
}

const port = Number(process.env.API_PORT ?? 4000)
app.listen(port, () => {
  console.log(`API Liquor Express (interno) en http://127.0.0.1:${port}`)
  console.log(`Base de datos: ${hayBD() ? 'Supabase conectada' : 'sin configurar (modo desarrollo)'}`)
  asegurarBucket()
})
