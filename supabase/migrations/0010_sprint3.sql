-- ============================================================
-- Liquor Express — Sprint 3 · Reportes, código de barras y jornada de caja
-- ============================================================

-- Código de barras (lector) — único cuando existe.
alter table public.productos add column if not exists codigo_barras text;
create unique index if not exists productos_codigo_barras_key on public.productos(codigo_barras) where codigo_barras is not null;

-- Jornada: el día al que pertenece la caja (aunque se cierre después de medianoche).
alter table public.sesiones_caja
  add column if not exists fecha_jornada date not null default ((now() at time zone 'America/Bogota')::date);

-- Reportes. El día de cada venta = jornada de su caja (o su fecha, si no tiene caja).
create or replace function public.rep_ventas_dia(desde date, hasta date)
returns table(fecha date, ventas bigint, total numeric, utilidad numeric)
language sql stable set search_path = public as $$
  with v as (
    select coalesce(s.fecha_jornada, (coalesce(x.vendida_en, x.creado_en) at time zone 'America/Bogota')::date) as fecha,
           x.total, x.utilidad
    from ventas x left join sesiones_caja s on s.id = x.sesion_id
    where x.estado = 'activa'
  )
  select fecha, count(*), coalesce(sum(total), 0), coalesce(sum(utilidad), 0)
  from v where fecha between desde and hasta
  group by fecha order by fecha
$$;

create or replace function public.rep_ventas_medio(desde date, hasta date)
returns table(medio text, ventas bigint, total numeric, reales numeric)
language sql stable set search_path = public as $$
  select x.medio_pago, count(*), coalesce(sum(x.total), 0), coalesce(sum(x.valor_reales), 0)
  from ventas x left join sesiones_caja s on s.id = x.sesion_id
  where x.estado = 'activa'
    and coalesce(s.fecha_jornada, (coalesce(x.vendida_en, x.creado_en) at time zone 'America/Bogota')::date) between desde and hasta
  group by x.medio_pago
$$;

create or replace function public.rep_productos(desde date, hasta date)
returns table(producto_id uuid, nombre text, es_pola boolean, unidades numeric, total numeric, costo numeric, pola_unidades numeric, pola_total numeric)
language sql stable set search_path = public as $$
  select p.id, p.nombre, p.es_pola,
    coalesce(sum(coalesce(i.unidades, i.cantidad)), 0),
    coalesce(sum(i.precio_unitario * i.cantidad), 0),
    coalesce(sum(i.costo_unitario * i.cantidad), 0),
    coalesce(sum(case when i.es_pola then coalesce(i.unidades, i.cantidad) else 0 end), 0),
    coalesce(sum(case when i.es_pola then i.precio_unitario * i.cantidad else 0 end), 0)
  from venta_items i
  join ventas x on x.id = i.venta_id
  left join sesiones_caja s on s.id = x.sesion_id
  join productos p on p.id = i.producto_id
  where x.estado = 'activa'
    and coalesce(s.fecha_jornada, (coalesce(x.vendida_en, x.creado_en) at time zone 'America/Bogota')::date) between desde and hasta
  group by p.id, p.nombre, p.es_pola
$$;

-- Solo el backend (service_role) puede ejecutarlas.
revoke all on function public.rep_ventas_dia(date, date) from public, anon, authenticated;
revoke all on function public.rep_ventas_medio(date, date) from public, anon, authenticated;
revoke all on function public.rep_productos(date, date) from public, anon, authenticated;
grant execute on function public.rep_ventas_dia(date, date) to service_role;
grant execute on function public.rep_ventas_medio(date, date) to service_role;
grant execute on function public.rep_productos(date, date) to service_role;