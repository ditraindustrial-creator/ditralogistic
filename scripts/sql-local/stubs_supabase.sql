-- Stubs mínimos de Supabase para validar las migraciones en un PostgreSQL local (sin Docker).
-- auth.uid() imita la función real: lee el "sub" de request.jwt.claims.
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
end $$;
grant usage on schema auth to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;
-- Supabase crea esta publicación (vacía) para Realtime; 0006 le agrega tablas.
set client_min_messages = error; -- sin wal_level=logical avisa; aquí no se replica nada
create publication supabase_realtime;
reset client_min_messages;
-- Storage: tablas y función mínimas con las mismas columnas que usan las migraciones y políticas.
-- (En Supabase las crea y administra el servicio de Storage; aquí solo sirven para probar RLS.)
create schema storage;
create table storage.buckets (
  id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text,
  owner uuid default auth.uid(),
  created_at timestamptz default now()
);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language plpgsql immutable as $$
declare _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1:array_length(_parts, 1) - 1];
end $$;
grant usage on schema storage to authenticated, anon;
grant all on storage.objects to authenticated;
grant select on storage.buckets to authenticated;
grant execute on function storage.foldername(text) to authenticated, anon;
