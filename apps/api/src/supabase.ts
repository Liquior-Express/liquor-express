import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Cliente de Supabase (base de datos). Se crea solo si hay credenciales;
// mientras no exista el proyecto, la API corre igual y avisa que no hay BD.
// Trata cadenas vacías como "ausente" (un `.env` con VAR= deja "" y `??`
// no lo considera nulo, por eso normalizamos).
const val = (v?: string) => (v && v.trim() !== '' ? v : undefined)
const url = val(process.env.SUPABASE_URL)
const key = val(process.env.SUPABASE_SERVICE_ROLE_KEY) ?? val(process.env.SUPABASE_ANON_KEY)

export const supabase: SupabaseClient | null =
  url && key ? createClient(url, key, { auth: { persistSession: false } }) : null

export const hayBD = () => supabase !== null
