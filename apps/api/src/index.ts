import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { supabase, hayBD } from './supabase.ts'

const app = express()
app.use(cors())
app.use(express.json())

// Salud del servidor
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, servicio: 'liquor-express-api', bd: hayBD() ? 'conectada' : 'sin configurar' })
})

// Productos (Sprint 1). Cuando exista Supabase, lee de la tabla `productos`.
app.get('/api/productos', async (_req, res) => {
  if (!hayBD() || !supabase) {
    return res.json({ fuente: 'sin-bd', productos: [], nota: 'Configura Supabase en .env para leer datos reales.' })
  }
  const { data, error } = await supabase.from('productos').select('*').order('nombre')
  if (error) return res.status(500).json({ error: error.message })
  res.json({ fuente: 'supabase', productos: data })
})

// Puerto INTERNO del API. En producción, Next toma el puerto público (PORT)
// y redirige /api hacia este puerto; por eso el API no debe usar PORT.
const port = Number(process.env.API_PORT ?? 4000)
app.listen(port, () => {
  console.log(`API Liquor Express (interno) en http://127.0.0.1:${port}`)
  console.log(`Base de datos: ${hayBD() ? 'Supabase conectada' : 'sin configurar (modo desarrollo)'}`)
})
