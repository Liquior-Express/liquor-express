-- 0012 · Control por empaques (cigarrillos) y código de barras por presentación
--
-- Algunos productos llegan en empaques cerrados (cajetilla x20, media cajetilla x10) y se
-- venden por empaque o sueltos, abriendo uno a la vez por marca. Se lleva la cuenta de lo
-- cerrado por presentación y de los sueltos del empaque abierto. productos.existencias
-- sigue siendo el total en unidades (sueltos + cerradas × unidades de cada empaque), así los
-- reportes, las alertas de stock y los costos no cambian.

alter table public.productos
  add column if not exists controla_empaques boolean not null default false,
  add column if not exists sueltos numeric(12,2) not null default 0;

alter table public.presentaciones
  add column if not exists cerradas numeric(12,2) not null default 0,
  add column if not exists codigo_barras text;

-- Escanear una cajetilla agrega una cajetilla: el código de cada presentación es único.
create unique index if not exists presentaciones_codigo_barras_key
  on public.presentaciones(codigo_barras) where codigo_barras is not null;

-- Abrir un empaque queda en el kardex (no cambia el total de unidades).
alter table public.movimientos_inventario drop constraint if exists movimientos_inventario_tipo_check;
alter table public.movimientos_inventario add constraint movimientos_inventario_tipo_check
  check (tipo in ('entrada', 'venta', 'merma', 'ajuste', 'apertura'));
