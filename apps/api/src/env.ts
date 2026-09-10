// Carga las variables de entorno desde apps/api/.env sin depender del
// directorio desde el que se lance el proceso (el monorepo arranca el API
// desde la raíz con `npm --prefix apps/api`, por eso resolvemos la ruta
// relativa a este archivo). Debe importarse ANTES que cualquier módulo que
// lea process.env (p. ej. supabase.ts).
import { config } from 'dotenv'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const dir = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(dir, '../.env') })
