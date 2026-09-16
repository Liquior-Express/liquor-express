-- 0014 · Clientes para facturación electrónica y pagos divididos
-- Clientes: los datos que pide la factura electrónica de la DIAN. La venta puede quedar a nombre de un
-- cliente; sin cliente es "consumidor final".
-- Pagos divididos: una venta se puede pagar con varios medios (pesos, reales, Nequi, Bold, PIX). La venta
-- queda con medio_pago = 'mixto' y cada parte en venta_pagos.
-- (ventas.cliente_id ya existe: es el id del equipo para no duplicar ventas sin conexión.)

create table if not exists public.clientes (
  id                     uuid primary key default gen_random_uuid(),
  tipo_persona           text not null default 'natural' check (tipo_persona in ('natural', 'juridica')),
  tipo_documento         text not null default 'CC' check (tipo_documento in ('CC', 'NIT', 'CE', 'PAS', 'TI', 'PEP', 'DIE')),
  numero_documento       text not null,
  dv                     text,
  nombre                 text not null,           -- nombres y apellidos, o razón social
  email                  text,                    -- a donde llega la factura electrónica
  telefono               text,
  direccion              text,
  ciudad                 text,
  departamento           text,
  responsable_iva        boolean not null default false,
  responsabilidad_fiscal text not null default 'R-99-PN', -- R-99-PN: no aplica / otros
  notas                  text,
  activo                 boolean not null default true,
  creado_en              timestamptz not null default now(),
  actualizado_en         timestamptz not null default now()
);
create unique index if not exists clientes_documento_key on public.clientes(tipo_documento, numero_documento);
create index if not exists clientes_nombre_idx on public.clientes(lower(nombre));
alter table public.clientes enable row level security;

alter table public.ventas
  add column if not exists comprador_id uuid references public.clientes(id) on delete set null;

-- Pagos divididos
alter table public.ventas drop constraint if exists ventas_medio_pago_check;
alter table public.ventas add constraint ventas_medio_pago_check
  check (medio_pago in ('efectivo', 'nequi', 'bold', 'pix', 'mixto'));

create table if not exists public.venta_pagos (
  id          uuid primary key default gen_random_uuid(),
  venta_id    uuid not null references public.ventas(id) on delete cascade,
  medio       text not null check (medio in ('efectivo', 'nequi', 'bold', 'pix')),
  moneda      text not null default 'COP' check (moneda in ('COP', 'BRL')),
  monto       numeric(12,2) not null check (monto > 0), -- lo que se recibió, en su moneda
  valor_pesos numeric(12,2) not null                    -- lo que aporta al total, en pesos (sin el cambio)
);
create index if not exists venta_pagos_venta_idx on public.venta_pagos(venta_id);
alter table public.venta_pagos enable row level security;
