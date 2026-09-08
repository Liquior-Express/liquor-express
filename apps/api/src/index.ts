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

const port = Number(process.env.PORT ?? 4000)
app.listen(port, () => {
  console.log(`API Liquor Express escuchando en http://localhost:${port}`)
  console.log(`Base de datos: ${hayBD() ? 'Supabase conectada' : 'sin configurar (modo desarrollo)'}`)
})
