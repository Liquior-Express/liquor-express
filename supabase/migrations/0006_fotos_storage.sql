-- ============================================================
-- Liquor Express — Bucket de Storage para fotos de producto
-- ------------------------------------------------------------
-- El bucket público `productos` se crea automáticamente desde el
-- backend al arrancar (apps/api/src/index.ts → asegurarBucket),
-- usando la service_role. No se crea aquí porque el rol de
-- migraciones no tiene permisos sobre el esquema `storage`.
-- ============================================================
select 1;