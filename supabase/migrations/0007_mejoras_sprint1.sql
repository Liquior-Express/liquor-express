-- ============================================================
-- Liquor Express — Mejoras Sprint 1
-- · Presencia: última actividad de cada usuario (quién está conectado)
-- · Costos por origen (Colombia / Brasil): un solo stock, varios costos
-- ============================================================

alter table public.usuarios add column if not exists ultima_actividad timestamptz;

create table if not exists public.costos_origen (
  id               uuid primary key default gen_random_uuid(),
  producto_id      uuid not null references public.productos(id) on delete cascade,
  origen           text not null check (origen in ('colombia','brasil')),
  proveedor        text,
  moneda           text not null default 'COP' check (moneda in ('COP','BRL')),
  costo_moneda     numeric(12,2) not null,          -- costo en la moneda en que se pagó
  tasa             numeric(12,2),                   -- pesos por 1 R$ (solo si moneda = BRL)
  costo_cop        numeric(12,2) not null,          -- costo convertido a pesos
  costos_variables numeric(12,2) not null default 0,
  actualizado_en   timestamptz not null default now()
);
create index if not exists idx_costos_origen_producto on public.costos_origen(producto_id);

-- Igual que el resto: RLS activo y sin acceso público (solo el backend).
alter table public.costos_origen enable row level security;
revoke all on public.costos_origen from anon, authenticated;