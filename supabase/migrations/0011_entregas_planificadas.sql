-- 0011_entregas_planificadas.sql
-- Horas planificadas de entrega para encuadernación.
-- Dos modelos: una hora global por trabajo (entrega_planificada) y filas por entrega parcial
-- (entregas_planificadas). Solo gestión puede INSERT/UPDATE/DELETE; todos los perfiles pueden SELECT.

-- Hora global planificada del trabajo (nullable; solo encuadernación la usa en la UI).
alter table trabajos
  add column entrega_planificada timestamptz;

-- Tabla de entregas parciales planificadas.
create table entregas_planificadas (
  id          uuid        primary key default gen_random_uuid(),
  trabajo_id  uuid        not null references trabajos(id) on delete cascade,
  hora        timestamptz not null,
  cantidad    int         not null check (cantidad > 0),
  nota        text,
  creado_por  uuid        not null references perfiles(usuario_id),
  creado_en   timestamptz not null default now()
);

-- RLS: SELECT para todo perfil autenticado; INSERT/UPDATE/DELETE solo gestión.
alter table entregas_planificadas enable row level security;

create policy ep_ver on entregas_planificadas
  for select to authenticated using (rol_actual() is not null);

create policy ep_gestion on entregas_planificadas
  for all to authenticated
  using (es_gestion()) with check (es_gestion());

-- Realtime: suscripción igual que movimientos (pantallas recargan al cambiar).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'entregas_planificadas'
  ) then
    alter publication supabase_realtime add table entregas_planificadas;
  end if;
end $$;
