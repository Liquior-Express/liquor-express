import type { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { supabase } from './supabase.ts'

export type Rol = 'cajero' | 'admin' | 'gerencia'

export interface Usuario {
  id: string
  usuario: string
  nombre: string
  rol: Rol
  activo: boolean
}

const SECRET = process.env.API_JWT_SECRET ?? ''
const EXPIRA = '12h' // una jornada

export const hashClave = (clave: string) => bcrypt.hash(clave, 10)
export const verificarClave = (clave: string, hash: string) => bcrypt.compare(clave, hash)
export const firmarToken = (id: string) => jwt.sign({ sub: id }, SECRET, { expiresIn: EXPIRA })

// ¿El rol ve la utilidad? (admin y gerencia sí; caja no)
export const veUtilidad = (rol: Rol) => rol === 'admin' || rol === 'gerencia'

// Columnas seguras a devolver (nunca el hash de la contraseña).
export const COLS_USUARIO = 'id, usuario, nombre, rol, activo, creado_en, ultima_actividad'

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request { usuario?: Usuario }
  }
}

// Presencia: registra la última actividad de cada usuario (como máximo cada 30 s).
const ultimaMarca = new Map<string, number>()
function marcarActividad(id: string) {
  const ahora = Date.now()
  if ((ultimaMarca.get(id) ?? 0) > ahora - 30_000) return
  ultimaMarca.set(id, ahora)
  supabase?.from('usuarios').update({ ultima_actividad: new Date(ahora).toISOString() }).eq('id', id).then(() => {}, () => {})
}
export function olvidarActividad(id: string) { ultimaMarca.delete(id) }

// Middleware: valida el token de sesión y carga el usuario (rol/activo frescos).
export async function autenticar(req: Request, res: Response, next: NextFunction) {
  if (!supabase) return res.status(503).json({ error: 'Base de datos no configurada' })
  if (!SECRET) return res.status(500).json({ error: 'Falta API_JWT_SECRET en el servidor' })

  const cab = req.header('authorization') ?? ''
  const token = cab.toLowerCase().startsWith('bearer ') ? cab.slice(7).trim() : null
  if (!token) return res.status(401).json({ error: 'Falta el token de sesión' })

  let payload: { sub: string }
  try {
    payload = jwt.verify(token, SECRET) as { sub: string }
  } catch {
    return res.status(401).json({ error: 'Sesión inválida o expirada' })
  }

  const { data: u, error: errU } = await supabase
    .from('usuarios')
    .select('id, usuario, nombre, rol, activo')
    .eq('id', payload.sub)
    .maybeSingle()

  // Una falla de conexión con la BD NO es una sesión inválida: no sacar al usuario por un corte de internet.
  if (errU) return res.status(503).json({ error: 'No se pudo verificar la sesión. Revisa la conexión e intenta de nuevo.' })
  if (!u) return res.status(401).json({ error: 'Usuario no encontrado' })
  if (!u.activo) return res.status(403).json({ error: 'Usuario inactivo' })

  // Al cerrar sesión no se vuelve a marcar como conectado.
  if (!req.originalUrl.startsWith('/api/auth/salir')) marcarActividad(u.id)
  req.usuario = u as Usuario
  next()
}

// Middleware de rol.
export function requiereRol(...roles: Rol[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.usuario) return res.status(401).json({ error: 'No autenticado' })
    if (!roles.includes(req.usuario.rol)) {
      return res.status(403).json({ error: 'No tienes permiso para esta acción' })
    }
    next()
  }
}
