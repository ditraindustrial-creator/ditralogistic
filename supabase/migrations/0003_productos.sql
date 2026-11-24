-- Catálogo de productos (herramientas y trabajos) importable desde el ERP (spec §5.2 y §5.4)

create table productos (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique check (codigo = btrim(codigo) and codigo <> ''),
  nombre text not null check (btrim(nombre) <> ''),
  area area not null
);

alter table productos enable row level security;

-- todos los usuarios con perfil leen; administración y gestión (secretaria, jefe de taller) modifican
create policy productos_ver on productos for select to authenticated using (rol_actual() is not null);
create policy productos_gestion on productos for all to authenticated
  using (es_gestion()) with check (es_gestion());
