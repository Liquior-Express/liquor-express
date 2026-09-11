-- ============================================================
-- Liquor Express — Sprint 2 · Caja
-- Cada venta pertenece a una sesión de caja; cierre con cuadre
-- de efectivo en pesos y en reales.
-- ============================================================

-- Ventas: sesión de caja y detalle del pago en efectivo (pesos o reales).
alter table public.ventas
  add column if not exists sesion_id uuid references public.sesiones_caja(id),
  add column if not exists moneda_efectivo text check (moneda_efectivo in ('COP','BRL')),
  add column if not exists efectivo_recibido numeric(12,2),
  add column if not exists cambio numeric(12,2),
  add column if not exists cambio_en text check (cambio_en in ('COP','BRL'));
create index if not exists idx_ventas_sesion on public.ventas(sesion_id);

-- Sesiones de caja: base y conteo en reales, totales y diferencias del cierre.
alter table public.sesiones_caja
  add column if not exists base_reales numeric(12,2) not null default 0,
  add column if not exists total_ventas numeric(12,2) not null default 0,
  add column if not exists total_efectivo_reales numeric(12,2) not null default 0,
  add column if not exists total_ingresos numeric(12,2) not null default 0,
  add column if not exists total_egresos numeric(12,2) not null default 0,
  add column if not exists esperado_reales numeric(12,2) not null default 0,
  add column if not exists contado_efectivo numeric(12,2),
  add column if not exists contado_reales numeric(12,2),
  add column if not exists diferencia numeric(12,2),
  add column if not exists diferencia_reales numeric(12,2),
  add column if not exists tasa_real numeric(12,2),
  add column if not exists observaciones text,
  add column if not exists cerrada_por uuid references public.usuarios(id);

alter table public.movimientos_caja
  add column if not exists usuario_id uuid references public.usuarios(id);

-- Terminal único: solo puede haber UNA caja abierta a la vez.
create unique index if not exists sesiones_caja_una_abierta
  on public.sesiones_caja ((estado)) where estado = 'abierta';