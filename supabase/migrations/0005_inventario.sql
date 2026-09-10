-- ============================================================
-- Liquor Express — Inventario: umbral de stock bajo por producto
-- ============================================================

-- Nivel mínimo para alertar "stock bajo" (0 = sin alerta para ese producto).
alter table public.productos
  add column if not exists stock_min numeric(12,2) not null default 0;