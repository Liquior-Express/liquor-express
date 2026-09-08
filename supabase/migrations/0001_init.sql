-- ============================================================
-- Liquor Express — esquema inicial (según MODELO_DE_DATOS v1.0)
-- Base de datos: Supabase (PostgreSQL)
-- ============================================================

-- 1 · Usuarios y acceso ---------------------------------------
create table if not exists usuarios (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null,
  rol         text not null check (rol in ('cajero','admin','gerencia')),
  activo      boolean not null default true,
  creado_en   timestamptz not null default now()
);

-- 2 · Catálogo ------------------------------------------------
create table if not exists categorias (
  id      uuid primary key default gen_random_uuid(),
  nombre  text not null unique
);

create table if not exists productos (
  id                   uuid primary key default gen_random_uuid(),
  nombre               text not null,
  categoria_id         uuid references categorias(id),
  foto_url             text,
  unidad_base          text not null default 'unidad',
  costo                numeric(12,2) not null default 0,
  costos_variables     numeric(12,2) not null default 0,
  margen_pct           numeric(5,2)  not null default 25,
  precio_venta         numeric(12,2) not null default 0,
  existencias          numeric(12,2) not null default 0,
  es_pola              boolean not null default false,
  controla_vencimiento boolean not null default false,
  activo               boolean not null default true,
  creado_en            timestamptz not null default now()
);

create table if not exists presentaciones (
  id              uuid primary key default gen_random_uuid(),
  producto_id     uuid not null references productos(id) on delete cascade,
  nombre          text not null,                 -- Caja, Six, Cartón, Cajetilla, Unidad
  factor_unidades numeric(12,4) not null,
  precio          numeric(12,2) not null
);

-- 3 · Existencias, kardex y vencimiento -----------------------
create table if not exists lotes (
  id                 uuid primary key default gen_random_uuid(),
  producto_id        uuid not null references productos(id) on delete cascade,
  cantidad           numeric(12,2) not null default 0,
  fecha_vencimiento  date,
  costo_lote         numeric(12,2)
);

create table if not exists movimientos_inventario (
  id           uuid primary key default gen_random_uuid(),
  producto_id  uuid not null references productos(id),
  tipo         text not null check (tipo in ('entrada','venta','merma','ajuste')),
  cantidad     numeric(12,2) not null,           -- + entra / - sale
  referencia   text,                             -- id de compra/venta/merma
  usuario_id   uuid references usuarios(id),
  creado_en    timestamptz not null default now()
);

create table if not exists mermas (
  id           uuid primary key default gen_random_uuid(),
  producto_id  uuid not null references productos(id),
  cantidad     numeric(12,2) not null,
  motivo       text not null check (motivo in ('vencido','faltante','averia')),
  usuario_id   uuid references usuarios(id),
  creado_en    timestamptz not null default now()
);

-- 4 · Compras -------------------------------------------------
create table if not exists proveedores (
  id       uuid primary key default gen_random_uuid(),
  nombre   text not null,
  contacto text
);

create table if not exists compras (
  id            uuid primary key default gen_random_uuid(),
  proveedor_id  uuid references proveedores(id),
  usuario_id    uuid references usuarios(id),
  total         numeric(12,2) not null default 0,
  creado_en     timestamptz not null default now()
);

create table if not exists compra_items (
  id                uuid primary key default gen_random_uuid(),
  compra_id         uuid not null references compras(id) on delete cascade,
  producto_id       uuid not null references productos(id),
  presentacion      text,
  cantidad          numeric(12,2) not null,
  valor_unitario    numeric(12,2) not null,
  costos_variables  numeric(12,2) not null default 0,
  margen_pct        numeric(5,2)  not null default 25,
  precio_calculado  numeric(12,2) not null
);

-- 5 · Ventas y pagos ------------------------------------------
create table if not exists ventas (
  id           uuid primary key default gen_random_uuid(),
  usuario_id   uuid references usuarios(id),
  subtotal     numeric(12,2) not null default 0,
  utilidad     numeric(12,2) not null default 0,
  total        numeric(12,2) not null default 0,
  medio_pago   text not null check (medio_pago in ('efectivo','nequi','bold','pix')),
  valor_reales numeric(12,2),                    -- solo si medio_pago = pix
  tasa_real    numeric(12,2),
  estado_dian  text not null default 'no_enviada' check (estado_dian in ('no_enviada','enviada')),
  creado_en    timestamptz not null default now()
);

create table if not exists venta_items (
  id               uuid primary key default gen_random_uuid(),
  venta_id         uuid not null references ventas(id) on delete cascade,
  producto_id      uuid not null references productos(id),
  presentacion     text,
  cantidad         numeric(12,2) not null,
  precio_unitario  numeric(12,2) not null,
  costo_unitario   numeric(12,2) not null default 0,
  es_pola          boolean not null default false
);

create table if not exists tasa_real (
  fecha  date primary key,
  valor  numeric(12,2) not null                  -- pesos por 1 Real
);

-- 6 · Facturación DIAN (selectiva) ----------------------------
create table if not exists facturas_dian (
  id                 uuid primary key default gen_random_uuid(),
  venta_id           uuid not null references ventas(id),
  cliente_documento  text,
  cliente_nombre     text,
  estado             text not null default 'pendiente' check (estado in ('pendiente','aceptada','rechazada')),
  cufe               text,
  fecha_envio        timestamptz
);

-- 7 · Caja, gastos y caja menor -------------------------------
create table if not exists sesiones_caja (
  id             uuid primary key default gen_random_uuid(),
  usuario_id     uuid references usuarios(id),
  base_apertura  numeric(12,2) not null default 0,
  total_efectivo numeric(12,2) not null default 0,
  total_nequi    numeric(12,2) not null default 0,
  total_bold     numeric(12,2) not null default 0,
  total_pix      numeric(12,2) not null default 0,
  esperado_caja  numeric(12,2) not null default 0,
  apertura       timestamptz not null default now(),
  cierre         timestamptz,
  estado         text not null default 'abierta' check (estado in ('abierta','cerrada'))
);

create table if not exists movimientos_caja (
  id         uuid primary key default gen_random_uuid(),
  sesion_id  uuid references sesiones_caja(id),
  tipo       text not null check (tipo in ('ingreso','egreso')),
  concepto   text,
  valor      numeric(12,2) not null,
  creado_en  timestamptz not null default now()
);

create table if not exists gastos (
  id          uuid primary key default gen_random_uuid(),
  categoria   text not null,                     -- arriendo, servicios, nomina, transporte, otros
  descripcion text,
  valor       numeric(12,2) not null,
  paga_con    text not null default 'caja' check (paga_con in ('caja','caja_menor')),
  usuario_id  uuid references usuarios(id),
  creado_en   timestamptz not null default now()
);

create table if not exists caja_menor (
  id     uuid primary key default gen_random_uuid(),
  saldo  numeric(12,2) not null default 0
);

create table if not exists movimientos_caja_menor (
  id         uuid primary key default gen_random_uuid(),
  tipo       text not null check (tipo in ('gasto','reposicion')),
  valor      numeric(12,2) not null,
  gasto_id   uuid references gastos(id),
  usuario_id uuid references usuarios(id),
  creado_en  timestamptz not null default now()
);

-- 10 · Seguridad — bitácora de auditoría ----------------------
create table if not exists auditoria (
  id          uuid primary key default gen_random_uuid(),
  usuario_id  uuid references usuarios(id),
  accion      text not null,                     -- 'anular_venta', 'cambiar_precio', 'cerrar_caja', ...
  entidad     text,
  entidad_id  text,
  detalle     jsonb,
  creado_en   timestamptz not null default now()
);

-- Índices útiles
create index if not exists idx_productos_categoria on productos(categoria_id);
create index if not exists idx_venta_items_venta on venta_items(venta_id);
create index if not exists idx_mov_inv_producto on movimientos_inventario(producto_id);
create index if not exists idx_ventas_fecha on ventas(creado_en);
create index if not exists idx_auditoria_fecha on auditoria(creado_en);
