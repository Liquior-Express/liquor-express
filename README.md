# Liquor Express — Monorepo

Sistema de administración para la licorera **Liquor Express** (Leticia, Amazonas).
Desarrollado por **JCA Soft** · filosofía Kaizen.

## Estructura

```
liquor-express/
  apps/
    web/     Frontend — Next.js (App Router) + TypeScript
    api/     Backend  — Node.js + Express
  supabase/
    migrations/   Esquema de la base de datos (SQL)
  package.json    Scripts del monorepo (concurrently)
```

## Stack

- **Frontend:** Next.js + TypeScript
- **Backend:** Node.js + Express
- **Base de datos:** Supabase (PostgreSQL)
- **Despliegue:** Railway (bajo costo)
- **Auth y seguridad:** por rol (cajero / admin / gerencia), bitácora de auditoría

## Puesta en marcha (desarrollo)

```bash
# 1. Instalar dependencias
npm run install:all      # web + api
npm install              # concurrently (monorepo)

# 2. Variables de entorno
cp apps/web/.env.local.example apps/web/.env.local
cp apps/api/.env.example apps/api/.env
#    completar con la URL y llaves de Supabase

# 3. Correr todo
npm run dev
#    web → http://localhost:3000
#    api → http://localhost:4000/api/health
```

## Base de datos

El esquema está en `supabase/migrations/0001_init.sql`. Se aplica en el proyecto
de Supabase (SQL Editor o CLI). En desarrollo: proyecto de JCA Soft; en producción:
proyecto del cliente (JCA entra como colaborador).

## Ambientes

Todo se configura por **variables de entorno**: pasar de desarrollo a producción
es cambiar los archivos `.env`. Las credenciales nunca se suben al repositorio.
