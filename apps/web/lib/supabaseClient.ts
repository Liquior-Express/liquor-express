import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Cliente de Supabase para el navegador (frontend).
// Usa las llaves públicas (anon). Se crea solo si están configuradas.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

export const supabase: SupabaseClient | null =
  url && anon ? createClient(url, anon) : null
