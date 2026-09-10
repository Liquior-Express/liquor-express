-- ============================================================
-- Liquor Express — Usuarios locales (nombre de acceso + contraseña)
-- Reemplaza el modelo basado en Supabase Auth por correo.
-- Los usuarios (Gerencia / Admin / Caja) son internos, los gestiona
-- el administrador, y NO usan correo. El acceso se controla en el
-- backend (Express); la BD queda bloqueada salvo para el backend.
-- ============================================================

-- 1 · Quitar las políticas RLS basadas en Supabase Auth (auth.uid()).
--     Ya no aplican: nadie inicia sesión contra Supabase Auth.
do $$
declare r record;
begin
  for r in select policyname, tablename from pg_policies where schemaname = 'public'
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- 2 · Quitar la función/esquema privado y los privilegios de los roles públicos.
--     RLS SIGUE ACTIVO en todas las tablas y, sin políticas, solo el backend
--     (service_role) puede leer/escribir. Puerta cerrada; el backend tiene la llave.
drop function if exists private.mi_rol();
drop schema if exists private cascade;
revoke all on all tables in schema public from anon, authenticated;

-- 3 · Desligar usuarios de auth.users y volver a id propio.
alter table public.usuarios drop constraint if exists usuarios_auth_fk;
alter table public.usuarios alter column id set default gen_random_uuid();

-- Limpiar el usuario admin que estaba ligado a Auth (modelo anterior).
delete from public.usuarios;

-- 4 · Nuevos campos: nombre de acceso (corto, único) + hash de contraseña.
alter table public.usuarios add column if not exists usuario text;
alter table public.usuarios add column if not exists password_hash text;

-- Único sin distinguir mayúsculas ("Admin" = "admin").
create unique index if not exists usuarios_usuario_key on public.usuarios (lower(usuario));