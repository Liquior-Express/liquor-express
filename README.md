# Liquor Express — Monorepo

Sistema de administración para la licorera **Liquor Express** (Leticia, Amazonas).
Desarrollado por **JCA Soft** · filosofía Kaizen.

## Estructura

```
liquor-express/
  apps/
    web/     Frontend — Next.js (App Router) + TypeScript   → puerto público
    api/     Backend  — Node.js + Express                   → puerto interno (API_PORT, 4000)
  supabase/
    migrations/   Esquema de la base de datos (SQL)
  package.json    Scripts del monorepo (concurrently)
  Procfile        Arranque para Railway
```

## Stack

- **Frontend:** Next.js + TypeScript
- **Backend:** Node.js + Express (corre en el mismo servicio, puerto interno)
- **Base de datos:** Supabase (PostgreSQL)
- **Despliegue:** Railway — **un solo servicio** para front + back (menor costo)
- **Auth y seguridad:** por rol (cajero / admin / gerencia), bitácora de auditoría

## Cómo funciona el despliegue en un solo servidor

Front y back se despliegan juntos en **un único servicio de Railway**:

- **Next.js** toma el puerto público (`PORT` que asigna Railway).
- **Express** corre en un puerto **interno** (`API_PORT`, por defecto 4000).
- Next **redirige** `/api/*` hacia el API interno (`next.config.mjs` → `rewrites`).
- Así el front y el back comparten el mismo dominio y **se paga un solo servicio**.

Desde el frontend, el backend se llama siempre como `/api/...` (misma URL).

## Puesta en marcha (desarrollo)

```bash
npm install            # instala el monorepo y (por postinstall) ambos apps
cp apps/web/.env.local.example apps/web/.env.local
cp apps/api/.env.example apps/api/.env
#   completar con URL y llaves de Supabase

npm run dev
#   web → http://localhost:3000   (llama /api → redirige al API)
#   api → http://127.0.0.1:4000/api/health
```

## Despliegue (Railway)

- **Build:** `npm run build`  (compila el frontend Next.js)
- **Start:** `npm start`  (levanta Next + Express en el mismo servicio)
- Variables de entorno en Railway: `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
  (`PORT` lo asigna Railway; `API_PORT` puede quedar en 4000.)

## Ramas

- **`main`** — desarrollo / integración.
- **`produccion`** — lo que está desplegado. Se actualiza desde `main` cuando una versión está lista.

## Base de datos

El esquema está en `supabase/migrations/0001_init.sql`. Se aplica en el proyecto de
Supabase (SQL Editor o CLI). En desarrollo: proyecto de JCA Soft; en producción: del cliente.
