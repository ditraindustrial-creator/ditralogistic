-- Trazabilidad: esquema base, roles y RLS (spec §5.2 y §5.4)

create type rol as enum ('admin','secretaria','chofer','operario_afilado','operario_encuadernacion','jefe_taller');
create type area as enum ('afilado','encuadernacion');
create type modalidad as enum ('cliente','encomienda','ruta_propia');

create table perfiles (
  usuario_id uuid primary key references auth.users(id) on delete cascade,
  nombre text not null,
  rol rol not null
);

create table recorridos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  dia smallint not null check (dia between 1 and 5),
  camioneta text not null,
  lejano boolean not null default false
);

create table clientes (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  rut text not null,
  contacto text,
  direccion text,
  recorrido_id uuid references recorridos(id) on delete set null
);

create table etapas (
  id uuid primary key default gen_random_uuid(),
  area area not null,
  orden integer not null,
  nombre text not null,
  es_listo boolean not null default false,
  es_final boolean not null default false,
  unique (area, orden)
);

create table trabajos (
  id uuid primary key default gen_random_uuid(),
  numero bigint generated always as identity,
  cliente_id uuid not null references clientes(id),
  area area not null,
  entrada modalidad not null,
  salida modalidad not null,
  recibido_en timestamptz not null default now(),
  guia_retiro text,
  guia_despacho text,
  factura text,
  transporte text,
  urgente boolean not null default false,
  notas text,
  foto_documento text
);

create table lineas (
  id uuid primary key default gen_random_uuid(),
  trabajo_id uuid not null references trabajos(id) on delete cascade,
  producto text not null,
  cantidad integer not null check (cantidad > 0),
  nota text
);

create table movimientos (
  id uuid primary key default gen_random_uuid(),
  linea_id uuid not null references lineas(id) on delete cascade,
  cantidad integer not null check (cantidad > 0),
  etapa_origen_id uuid references etapas(id),
  etapa_destino_id uuid not null references etapas(id),
  usuario_id uuid not null references perfiles(usuario_id),
  creado_en timestamptz not null default now()
);

create table visitas (
  id uuid primary key default gen_random_uuid(),
  fecha date not null,
  cliente_id uuid not null references clientes(id),
  recorrido_id uuid not null references recorridos(id),
  confirmada text not null default 'sin_respuesta' check (confirmada in ('si','no','sin_respuesta')),
  requiere_confirmacion boolean not null default false,
  solicitada boolean not null default false,
  nota text
);

create index on trabajos (cliente_id);
create index on lineas (trabajo_id);
create index on movimientos (linea_id);
create index on visitas (fecha);

-- Etapas iniciales (editables por el administrador)
insert into etapas (area, orden, nombre, es_listo, es_final) values
  ('afilado', 1, 'Recibido', false, false),
  ('afilado', 2, 'En taller', false, false),
  ('afilado', 3, 'Afilado', false, false),
  ('afilado', 4, 'Listo', true, false),
  ('afilado', 5, 'Entregado', false, true),
  ('encuadernacion', 1, 'Recibido', false, false),
  ('encuadernacion', 2, 'En producción', false, false),
  ('encuadernacion', 3, 'Terminado', true, false),
  ('encuadernacion', 4, 'Entregado', false, true);

-- Funciones auxiliares de rol (security definer para evitar recursión de RLS en perfiles)
create function rol_actual() returns rol
  language sql stable security definer set search_path = public as
  $$ select rol from perfiles where usuario_id = auth.uid() $$;

create function area_del_operario() returns area
  language sql stable security definer set search_path = public as
  $$ select case rol_actual()
       when 'operario_afilado' then 'afilado'::area
       when 'operario_encuadernacion' then 'encuadernacion'::area
     end $$;

-- Roles que ven y editan todo lo operativo
create function es_gestion() returns boolean
  language sql stable security definer set search_path = public as
  $$ select coalesce(rol_actual() in ('admin','secretaria','jefe_taller'), false) $$;

create function puede_ver_area(a area) returns boolean
  language sql stable security definer set search_path = public as
  $$ select es_gestion() or rol_actual() = 'chofer' or area_del_operario() = a $$;

alter table perfiles enable row level security;
alter table recorridos enable row level security;
alter table clientes enable row level security;
alter table etapas enable row level security;
alter table trabajos enable row level security;
alter table lineas enable row level security;
alter table movimientos enable row level security;
alter table visitas enable row level security;

-- perfiles: cada uno ve el suyo; admin ve y gestiona todos
create policy perfiles_ver on perfiles for select to authenticated
  using (usuario_id = auth.uid() or rol_actual() = 'admin');
create policy perfiles_admin on perfiles for all to authenticated
  using (rol_actual() = 'admin') with check (rol_actual() = 'admin');

-- recorridos y etapas: todos leen; solo admin modifica
create policy recorridos_ver on recorridos for select to authenticated using (rol_actual() is not null);
create policy recorridos_admin on recorridos for all to authenticated
  using (rol_actual() = 'admin') with check (rol_actual() = 'admin');
create policy etapas_ver on etapas for select to authenticated using (rol_actual() is not null);
create policy etapas_admin on etapas for all to authenticated
  using (rol_actual() = 'admin') with check (rol_actual() = 'admin');

-- clientes: todos leen; gestión edita; chofer puede crear (retiro a cliente nuevo)
create policy clientes_ver on clientes for select to authenticated using (rol_actual() is not null);
create policy clientes_gestion on clientes for all to authenticated
  using (es_gestion()) with check (es_gestion());
create policy clientes_chofer_crea on clientes for insert to authenticated
  with check (rol_actual() = 'chofer');

-- trabajos: operarios solo su área; chofer ve todo y crea retiros; gestión todo
create policy trabajos_ver on trabajos for select to authenticated using (puede_ver_area(area));
create policy trabajos_crear on trabajos for insert to authenticated
  with check (es_gestion() or rol_actual() = 'chofer');
create policy trabajos_editar on trabajos for update to authenticated
  using (es_gestion() or rol_actual() = 'chofer') with check (es_gestion() or rol_actual() = 'chofer');
create policy trabajos_borrar on trabajos for delete to authenticated using (es_gestion());

-- lineas: siguen el área del trabajo
create policy lineas_ver on lineas for select to authenticated
  using (exists (select 1 from trabajos t where t.id = trabajo_id and puede_ver_area(t.area)));
create policy lineas_crear on lineas for insert to authenticated
  with check (es_gestion() or rol_actual() = 'chofer');
create policy lineas_editar on lineas for update to authenticated
  using (es_gestion()) with check (es_gestion());
create policy lineas_borrar on lineas for delete to authenticated using (es_gestion());

-- movimientos: registro; operarios mueven su área, chofer registra entregas/retiros
create policy movimientos_ver on movimientos for select to authenticated
  using (exists (select 1 from lineas l join trabajos t on t.id = l.trabajo_id
                 where l.id = linea_id and puede_ver_area(t.area)));
create policy movimientos_crear on movimientos for insert to authenticated
  with check (
    usuario_id = auth.uid()
    and exists (select 1 from lineas l join trabajos t on t.id = l.trabajo_id
                where l.id = linea_id
                  and (es_gestion() or rol_actual() = 'chofer' or area_del_operario() = t.area))
  );
-- sin update/delete: el historial no se reescribe

-- visitas: gestión y chofer leen; gestión edita; chofer puede agregar visitas
create policy visitas_ver on visitas for select to authenticated
  using (es_gestion() or rol_actual() = 'chofer');
create policy visitas_gestion on visitas for all to authenticated
  using (es_gestion()) with check (es_gestion());
create policy visitas_chofer_crea on visitas for insert to authenticated
  with check (rol_actual() = 'chofer');
