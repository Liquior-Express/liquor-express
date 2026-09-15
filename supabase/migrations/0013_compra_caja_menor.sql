-- 0013 · Pagos con caja menor, Nequi o Bold
-- De la caja del día no sale plata: las compras, los pagos de compras a crédito y los gastos se pagan
-- con la caja menor, Nequi o Bold. El efectivo del día pasa a la caja menor al cerrar la caja.
-- Las formas de antes (efectivo_caja, caja, transferencia) se mantienen para leer el historial.
alter table public.compras drop constraint if exists compras_forma_pago_check;
alter table public.compras add constraint compras_forma_pago_check
  check (forma_pago in ('caja_menor', 'nequi', 'bold', 'credito', 'efectivo_caja', 'transferencia'));
alter table public.compras drop constraint if exists compras_pagada_con_check;
alter table public.compras add constraint compras_pagada_con_check
  check (pagada_con in ('caja_menor', 'nequi', 'bold', 'efectivo_caja', 'transferencia'));

alter table public.gastos drop constraint if exists gastos_paga_con_check;
alter table public.gastos add constraint gastos_paga_con_check
  check (paga_con in ('caja_menor', 'nequi', 'bold', 'caja', 'transferencia'));
alter table public.gastos alter column paga_con set default 'caja_menor';

-- Lo que se compra con la caja menor queda en sus movimientos, ligado a la compra.
alter table public.movimientos_caja_menor drop constraint if exists movimientos_caja_menor_tipo_check;
alter table public.movimientos_caja_menor add constraint movimientos_caja_menor_tipo_check
  check (tipo in ('gasto', 'reposicion', 'compra'));
alter table public.movimientos_caja_menor
  add column if not exists compra_id uuid references public.compras(id) on delete set null;
