-- 0011 · Entradas y salidas de caja en pesos o en reales
-- Cada movimiento manual de caja indica en qué moneda entró o salió el efectivo,
-- para cuadrar por separado el cajón de pesos y el de reales.
alter table public.movimientos_caja
  add column if not exists moneda text not null default 'COP' check (moneda in ('COP', 'BRL'));
