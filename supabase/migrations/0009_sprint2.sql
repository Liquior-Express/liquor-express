-- ============================================================
-- Liquor Express — Sprint 2 · Compras, historial de ventas,
-- gastos, caja menor, flujo de caja y ventas sin conexión
-- ============================================================

-- Proveedores
alter table public.proveedores
  add column if not exists nit text,
  add column if not exists origen text not null default 'colombia' check (origen in ('colombia','brasil')),
  add column if not exists activo boolean not null default true,
  add column if not exists creado_en timestamptz not null default now();

-- Compras (cabecera): factura, origen/moneda, costos variables y pago
alter table public.compras
  add column if not exists factura text,
  add column if not exists fecha date not null default ((now() at time zone 'America/Bogota')::date),
  add column if not exists origen text not null default 'colombia' check (origen in ('colombia','brasil')),
  add column if not exists moneda text not null default 'COP' check (moneda in ('COP','BRL')),
  add column if not exists tasa numeric(12,2),
  add column if not exists subtotal numeric(12,2) not null default 0,
  add column if not exists costos_variables numeric(12,2) not null default 0,
  add column if not exists forma_pago text not null default 'transferencia' check (forma_pago in ('efectivo_caja','transferencia','credito')),
  add column if not exists estado_pago text not null default 'pagada' check (estado_pago in ('pagada','pendiente')),
  add column if not exists pagada_en timestamptz,
  add column if not exists pagada_con text check (pagada_con in ('efectivo_caja','transferencia')),
  add column if not exists notas text;
create index if not exists idx_compras_fecha on public.compras(fecha);

-- Compras (detalle): presentación recibida, unidades y costo final por unidad
alter table public.compra_items
  add column if not exists presentacion_id uuid references public.presentaciones(id) on delete set null,
  add column if not exists factor_unidades numeric(12,4) not null default 1,
  add column if not exists unidades numeric(12,2) not null default 0,
  add column if not exists costo_unitario_cop numeric(12,2) not null default 0,
  add column if not exists fecha_vencimiento date,
  add column if not exists precio_nuevo numeric(12,2);

-- Lotes: de qué compra vienen
alter table public.lotes
  add column if not exists compra_id uuid references public.compras(id) on delete set null,
  add column if not exists creado_en timestamptz not null default now();

-- Ventas: anulación, ventas hechas sin conexión (id del equipo) y unidades por ítem
alter table public.ventas
  add column if not exists estado text not null default 'activa' check (estado in ('activa','anulada')),
  add column if not exists anulada_por uuid references public.usuarios(id),
  add column if not exists anulada_en timestamptz,
  add column if not exists motivo_anulacion text,
  add column if not exists cliente_id text,
  add column if not exists vendida_en timestamptz;
create unique index if not exists ventas_cliente_id_key on public.ventas(cliente_id) where cliente_id is not null;
alter table public.venta_items add column if not exists unidades numeric(12,2);

-- Movimientos de caja creados por compras / gastos / caja menor (null = manual)
alter table public.movimientos_caja add column if not exists referencia text;

-- Gastos: también por transferencia, con fecha
alter table public.gastos drop constraint if exists gastos_paga_con_check;
alter table public.gastos add constraint gastos_paga_con_check check (paga_con in ('caja','caja_menor','transferencia'));
alter table public.gastos add column if not exists fecha date not null default ((now() at time zone 'America/Bogota')::date);
create index if not exists idx_gastos_fecha on public.gastos(fecha);

-- Caja menor (un solo fondo)
alter table public.movimientos_caja_menor
  add column if not exists concepto text,
  add column if not exists origen text check (origen in ('caja','transferencia'));
insert into public.caja_menor (saldo) select 0 where not exists (select 1 from public.caja_menor);