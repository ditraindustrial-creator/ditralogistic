-- Las 12 migraciones de supabase/migrations/ juntas, en orden, para pegarlas de una vez en el SQL Editor
-- de un proyecto Supabase NUEVO (vacío). No lo ejecutes sobre una base que ya tenga las migraciones.

-- ===== 0001_esquema.sql =====
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
  notas text
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

-- ===== 0002_mover_unidades.sql =====
-- Avance por cantidad (spec §5.2): el estado de una línea se calcula desde movimientos.
-- La integridad de cada movimiento se impone en la base, venga de mover_unidades o de un
-- insert directo (p. ej. la recepción inicial de crearTrabajo):
--   * la línea se bloquea (for update) para serializar movimientos concurrentes;
--   * origen y destino pertenecen al área del trabajo de la línea y son distintos;
--   * cantidad entera > 0 y no mayor que lo que hay en el origen;
--   * sin origen (recepción): lo recibido en total no supera la cantidad de la línea.

-- El historial no se borra en silencio: borrar una línea (o un trabajo) con movimientos falla.
alter table movimientos drop constraint movimientos_linea_id_fkey;
alter table movimientos add constraint movimientos_linea_id_fkey
  foreign key (linea_id) references lineas(id) on delete restrict;

alter table movimientos add constraint movimientos_origen_distinto_destino
  check (etapa_origen_id is distinct from etapa_destino_id);

-- Unidades de una línea en una etapa (destinos menos orígenes). Corre como quien llama, así
-- que respeta RLS; dentro del trigger (security definer) ve todos los movimientos.
create function unidades_en_etapa(p_linea uuid, p_etapa uuid) returns integer
  language sql stable security invoker set search_path = public as
  $$ select coalesce(sum(case when etapa_destino_id = p_etapa then cantidad else 0 end), 0)
          - coalesce(sum(case when etapa_origen_id = p_etapa then cantidad else 0 end), 0)
       from movimientos where linea_id = p_linea $$;
revoke execute on function unidades_en_etapa(uuid, uuid) from public;
grant execute on function unidades_en_etapa(uuid, uuid) to authenticated;

-- security definer: debe ver y bloquear la línea aunque el usuario no tenga permiso de
-- update sobre lineas. Quién puede insertar lo sigue decidiendo la política movimientos_crear.
create function movimientos_validar() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  v_area area;
  v_total integer;
  v_disponibles integer;
  v_recibidas integer;
begin
  select t.area, l.cantidad into v_area, v_total
    from lineas l join trabajos t on t.id = l.trabajo_id
   where l.id = new.linea_id
     for update of l;
  if not found then
    raise exception 'La línea no existe.' using errcode = 'P0001';
  end if;

  -- Usuario con sesión: debe poder mover esta área (evita revelar datos de otras áreas).
  if auth.uid() is not null
     and not (es_gestion() or rol_actual() = 'chofer' or area_del_operario() = v_area) then
    raise exception 'No tienes permiso para mover unidades de esta área.' using errcode = '42501';
  end if;

  if new.cantidad is null or new.cantidad <= 0 then
    raise exception 'La cantidad debe ser un número entero mayor que cero.' using errcode = 'P0001';
  end if;
  if new.etapa_origen_id is not distinct from new.etapa_destino_id then
    raise exception 'La etapa de origen y la de destino deben ser distintas.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from etapas where id = new.etapa_destino_id and area = v_area)
     or (new.etapa_origen_id is not null
         and not exists (select 1 from etapas where id = new.etapa_origen_id and area = v_area)) then
    raise exception 'Las etapas no corresponden al área del trabajo.' using errcode = 'P0001';
  end if;

  if new.etapa_origen_id is null then
    select coalesce(sum(cantidad), 0) into v_recibidas
      from movimientos where linea_id = new.linea_id and etapa_origen_id is null;
    if v_recibidas + new.cantidad > v_total then
      raise exception 'La línea tiene % unidades y ya se recibieron %; no se pueden recibir % más.',
        v_total, v_recibidas, new.cantidad using errcode = 'P0001';
    end if;
  else
    v_disponibles := unidades_en_etapa(new.linea_id, new.etapa_origen_id);
    if new.cantidad > v_disponibles then
      raise exception 'Solo hay % % en esta etapa; no se pueden mover %.',
        v_disponibles, case when v_disponibles = 1 then 'unidad' else 'unidades' end, new.cantidad
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
revoke execute on function movimientos_validar() from public;

create trigger movimientos_validar before insert on movimientos
  for each row execute function movimientos_validar();

-- Mueve unidades de una etapa a otra. Corre como quien llama (security invoker): el insert
-- pasa por la política movimientos_crear (usuario_id = auth.uid() y permiso por área) y por
-- el trigger movimientos_validar (bloqueo de la línea y reglas de cantidad y etapas).
create function mover_unidades(p_linea uuid, p_cantidad int, p_origen uuid, p_destino uuid)
  returns movimientos
  language plpgsql security invoker set search_path = public as $$
declare
  v_mov movimientos;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión para mover unidades.' using errcode = '42501';
  end if;
  if p_linea is null or p_origen is null or p_destino is null then
    raise exception 'Faltan la línea, la etapa de origen o la de destino.' using errcode = 'P0001';
  end if;
  insert into movimientos (linea_id, cantidad, etapa_origen_id, etapa_destino_id, usuario_id)
    values (p_linea, p_cantidad, p_origen, p_destino, auth.uid())
    returning * into v_mov;
  return v_mov;
end $$;
revoke execute on function mover_unidades(uuid, int, uuid, uuid) from public;
grant execute on function mover_unidades(uuid, int, uuid, uuid) to authenticated;

-- ===== 0003_productos.sql =====
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

-- ===== 0004_clientes_rut_unico.sql =====
-- La importación de clientes es idempotente por RUT: el RUT debe ser único (formato 12345678-5).
-- Si ya hubiera clientes con RUT repetido, esta migración falla a propósito: hay que fusionarlos antes.
create unique index clientes_rut_unico on clientes (rut);

-- ===== 0005_recepcion.sql =====
-- Recepción de trabajos (spec §5.3, pantalla 2) y guardas de integridad pendientes de la tarea 2.
--   * crear_trabajo(jsonb): crea trabajo, líneas y movimiento inicial de cada línea en UNA sola
--     llamada (una transacción): o queda todo o no queda nada.
--   * La recepción (movimiento sin origen) solo puede ir a la PRIMERA etapa del área.
--   * Guardas BEFORE UPDATE: no se baja la cantidad de una línea por debajo de lo recibido, no se
--     cambia el trabajo de una línea con movimientos y no se cambia el área de un trabajo con movimientos.
-- trabajos.numero ya es correlativo (identity, desde 0001): es el número que ve el usuario. Puede
-- haber saltos si una creación falla (las secuencias no se revierten); nunca se repite.

-- ---------------------------------------------------------------------------------------------
-- Trigger de movimientos: misma lógica de 0002 + recepción solo a la primera etapa del área.
-- Además bloquea (en modo compartido) la fila del trabajo, para que un cambio de área
-- concurrente espere a este movimiento o lo vea ya confirmado (ver trabajos_guardar).
-- ---------------------------------------------------------------------------------------------
create or replace function movimientos_validar() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_area area;
  v_total integer;
  v_disponibles integer;
  v_recibidas integer;
begin
  select t.area, l.cantidad into v_area, v_total
    from lineas l join trabajos t on t.id = l.trabajo_id
   where l.id = new.linea_id
     for update of l for share of t;
  if not found then
    raise exception 'La línea no existe.' using errcode = 'P0001';
  end if;

  -- Usuario con sesión: debe poder mover esta área (evita revelar datos de otras áreas).
  if auth.uid() is not null
     and not (es_gestion() or rol_actual() = 'chofer' or area_del_operario() = v_area) then
    raise exception 'No tienes permiso para mover unidades de esta área.' using errcode = '42501';
  end if;

  if new.cantidad is null or new.cantidad <= 0 then
    raise exception 'La cantidad debe ser un número entero mayor que cero.' using errcode = 'P0001';
  end if;
  if new.etapa_origen_id is not distinct from new.etapa_destino_id then
    raise exception 'La etapa de origen y la de destino deben ser distintas.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from etapas where id = new.etapa_destino_id and area = v_area)
     or (new.etapa_origen_id is not null
         and not exists (select 1 from etapas where id = new.etapa_origen_id and area = v_area)) then
    raise exception 'Las etapas no corresponden al área del trabajo.' using errcode = 'P0001';
  end if;

  if new.etapa_origen_id is null then
    -- Recepción: solo hacia la primera etapa (menor orden) del área.
    if new.etapa_destino_id is distinct from
       (select id from etapas where area = v_area order by orden limit 1) then
      raise exception 'La recepción solo puede ir a la primera etapa del área.' using errcode = 'P0001';
    end if;
    select coalesce(sum(cantidad), 0) into v_recibidas
      from movimientos where linea_id = new.linea_id and etapa_origen_id is null;
    if v_recibidas + new.cantidad > v_total then
      raise exception 'La línea tiene % unidades y ya se recibieron %; no se pueden recibir % más.',
        v_total, v_recibidas, new.cantidad using errcode = 'P0001';
    end if;
  else
    v_disponibles := unidades_en_etapa(new.linea_id, new.etapa_origen_id);
    if new.cantidad > v_disponibles then
      raise exception 'Solo hay % % en esta etapa; no se pueden mover %.',
        v_disponibles, case when v_disponibles = 1 then 'unidad' else 'unidades' end, new.cantidad
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
revoke execute on function movimientos_validar() from public;

-- ---------------------------------------------------------------------------------------------
-- Guardas de actualización. security definer: deben ver todos los movimientos aunque quien
-- actualiza no pueda leerlos por RLS. La fila que se actualiza ya está bloqueada por el UPDATE,
-- y movimientos_validar bloquea la línea (y comparte el trabajo), así que no hay carreras.
-- ---------------------------------------------------------------------------------------------
create function lineas_guardar() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_recibidas integer;
begin
  if new.trabajo_id is distinct from old.trabajo_id
     and exists (select 1 from movimientos where linea_id = old.id) then
    raise exception 'No se puede cambiar el trabajo de una línea que ya tiene movimientos.' using errcode = 'P0001';
  end if;
  if new.cantidad is distinct from old.cantidad then
    -- Las unidades repartidas entre etapas siempre suman lo recibido: no se puede bajar de ahí.
    select coalesce(sum(cantidad), 0) into v_recibidas
      from movimientos where linea_id = old.id and etapa_origen_id is null;
    if new.cantidad < v_recibidas then
      raise exception 'La línea ya recibió % unidades; la cantidad no puede ser menor.', v_recibidas
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
revoke execute on function lineas_guardar() from public;
create trigger lineas_guardar before update on lineas
  for each row execute function lineas_guardar();

create function trabajos_guardar() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.area is distinct from old.area
     and exists (select 1 from movimientos m join lineas l on l.id = m.linea_id where l.trabajo_id = old.id) then
    raise exception 'No se puede cambiar el área de un trabajo que ya tiene movimientos.' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke execute on function trabajos_guardar() from public;
create trigger trabajos_guardar before update on trabajos
  for each row execute function trabajos_guardar();

-- ---------------------------------------------------------------------------------------------
-- crear_trabajo(p_datos): security invoker, así que RLS sigue mandando (trabajos_crear,
-- lineas_crear, movimientos_crear con usuario_id = auth.uid()) y el trigger valida cada movimiento.
-- p_datos = {
--   cliente_id: uuid, area: 'afilado'|'encuadernacion', entrada: modalidad,
--   salida?: modalidad (por defecto igual a entrada), urgente?: bool, guia_retiro?: text, notas?: text,
--   lineas: [{producto: text, cantidad: entero > 0, nota?: text}, ...]
-- }
-- ---------------------------------------------------------------------------------------------
create function crear_trabajo(p_datos jsonb) returns trabajos
  language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_cliente uuid;
  v_area area;
  v_entrada modalidad;
  v_salida modalidad;
  v_primera uuid;
  v_trabajo trabajos;
  v_linea_id uuid;
  v_lineas jsonb;
  v_l jsonb;
  v_n integer;
  v_producto text;
  v_cantidad integer;
  v_txt text;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión para recibir trabajos.' using errcode = '42501';
  end if;
  if not (es_gestion() or rol_actual() = 'chofer') then
    raise exception 'No tienes permiso para recibir trabajos.' using errcode = '42501';
  end if;
  if p_datos is null or jsonb_typeof(p_datos) <> 'object' then
    raise exception 'Faltan los datos del trabajo.' using errcode = 'P0001';
  end if;

  v_txt := p_datos ->> 'cliente_id';
  if v_txt is null or v_txt !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'Elige el cliente.' using errcode = 'P0001';
  end if;
  v_cliente := v_txt::uuid;
  if not exists (select 1 from clientes where id = v_cliente) then
    raise exception 'El cliente no existe.' using errcode = 'P0001';
  end if;

  if (p_datos ->> 'area') not in ('afilado', 'encuadernacion') or p_datos ->> 'area' is null then
    raise exception 'Elige el área (afilado o encuadernación).' using errcode = 'P0001';
  end if;
  v_area := (p_datos ->> 'area')::area;

  if coalesce(p_datos ->> 'entrada', '') not in ('cliente', 'encomienda', 'ruta_propia') then
    raise exception 'Elige cómo llegó el trabajo.' using errcode = 'P0001';
  end if;
  v_entrada := (p_datos ->> 'entrada')::modalidad;
  if p_datos ->> 'salida' is null then
    v_salida := v_entrada;
  elsif p_datos ->> 'salida' in ('cliente', 'encomienda', 'ruta_propia') then
    v_salida := (p_datos ->> 'salida')::modalidad;
  else
    raise exception 'La modalidad de salida no es válida.' using errcode = 'P0001';
  end if;

  v_lineas := p_datos -> 'lineas';
  if v_lineas is null or jsonb_typeof(v_lineas) <> 'array' or jsonb_array_length(v_lineas) = 0 then
    raise exception 'Agrega al menos una línea.' using errcode = 'P0001';
  end if;

  -- Validar todas las líneas antes de escribir nada (mensajes claros por número de línea).
  v_n := 0;
  for v_l in select * from jsonb_array_elements(v_lineas) loop
    v_n := v_n + 1;
    if jsonb_typeof(v_l) <> 'object'
       or jsonb_typeof(v_l -> 'producto') is distinct from 'string'
       or btrim(v_l ->> 'producto') = '' then
      raise exception 'La línea % necesita un producto.', v_n using errcode = 'P0001';
    end if;
    if jsonb_typeof(v_l -> 'cantidad') is distinct from 'number'
       or (v_l ->> 'cantidad') !~ '^[0-9]{1,9}$'
       or (v_l ->> 'cantidad')::bigint < 1 or (v_l ->> 'cantidad')::bigint > 2147483647 then
      raise exception 'La cantidad de la línea % debe ser un número entero mayor que cero.', v_n
        using errcode = 'P0001';
    end if;
  end loop;

  select id into v_primera from etapas where area = v_area order by orden limit 1;
  if v_primera is null then
    raise exception 'El área no tiene etapas configuradas.' using errcode = 'P0001';
  end if;

  insert into trabajos (cliente_id, area, entrada, salida, urgente, guia_retiro, notas)
    values (v_cliente, v_area, v_entrada, v_salida,
            coalesce((p_datos ->> 'urgente') = 'true', false),
            nullif(btrim(p_datos ->> 'guia_retiro'), ''),
            nullif(btrim(p_datos ->> 'notas'), ''))
    returning * into v_trabajo;

  for v_l in select * from jsonb_array_elements(v_lineas) loop
    v_producto := btrim(v_l ->> 'producto');
    v_cantidad := (v_l ->> 'cantidad')::integer;
    insert into lineas (trabajo_id, producto, cantidad, nota)
      values (v_trabajo.id, v_producto, v_cantidad, nullif(btrim(v_l ->> 'nota'), ''))
      returning id into v_linea_id;
    insert into movimientos (linea_id, cantidad, etapa_origen_id, etapa_destino_id, usuario_id)
      values (v_linea_id, v_cantidad, null, v_primera, auth.uid());
  end loop;

  return v_trabajo;
end $$;
revoke execute on function crear_trabajo(jsonb) from public;
grant execute on function crear_trabajo(jsonb) to authenticated;

-- ===== 0006_realtime.sql =====
-- La pantalla "Qué hay listo" se actualiza en vivo: Realtime debe publicar los cambios de movimientos.
-- (RLS sigue aplicando: cada usuario solo recibe los eventos de filas que puede leer.)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'movimientos'
  ) then
    alter publication supabase_realtime add table movimientos;
  end if;
end $$;

-- ===== 0007_ruta.sql =====
-- Ruta de mañana y hoja del chofer (spec §5.3 pantallas 4 y 5, §5.4, §7).
--   * entregar_unidades(jsonb, text): entrega (todo o nada) unidades listas de una o varias líneas,
--     moviéndolas a la etapa final del área y anotando el N° de guía o factura en el trabajo.
--   * Límites del chofer: de un trabajo solo cambia salida y guía de despacho;
--     solo agrega líneas a trabajos propios, de hoy y aún sin movimientos (crear_trabajo); y solo
--     registra recepciones (origen NULL) o entregas (de una etapa "listo" a una final).
--   * visitas: una por cliente y día hábil (upsert), recorrido opcional, permisos según §5.4.

-- Día calendario de hoy en Chile (las rutas y "hoy" se cuentan en hora local).
create function hoy_chile() returns date
  language sql stable set search_path = public, pg_temp as
  $$ select (now() at time zone 'America/Santiago')::date $$;

-- =============================================================================================
-- Trabajos: quién lo creó (para el permiso de líneas del chofer) y campos que puede tocar el chofer.
-- =============================================================================================
alter table trabajos add column creado_por uuid default auth.uid() references auth.users(id) on delete set null;

drop policy trabajos_crear on trabajos;
create policy trabajos_crear on trabajos for insert to authenticated
  with check (es_gestion() or (rol_actual() = 'chofer' and creado_por = auth.uid()));

-- Fuera de gestión (en la práctica el chofer, el único otro rol con permiso de update por RLS) solo
-- se cambian salida y guia_despacho. Se compara la fila completa menos esos campos,
-- así una columna nueva queda protegida por defecto. Sin sesión (migraciones, service role, borrados
-- en cascada de auth.users) no se limita.
create function trabajos_limitar_campos() returns trigger
  language plpgsql set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null and not es_gestion()
     and (to_jsonb(new) - array['salida', 'guia_despacho'])
         is distinct from (to_jsonb(old) - array['salida', 'guia_despacho']) then
    raise exception 'Solo puedes cambiar la salida y la guía de despacho de un trabajo.'
      using errcode = '42501';
  end if;
  return new;
end $$;
revoke execute on function trabajos_limitar_campos() from public;
create trigger trabajos_limitar_campos before update on trabajos
  for each row execute function trabajos_limitar_campos();

-- Líneas: el chofer solo agrega líneas a un trabajo que creó él, hoy, y que aún no tiene movimientos
-- (es lo que hace crear_trabajo, que ahora inserta todas las líneas antes de los movimientos).
-- security definer: lee trabajos y movimientos sin depender de RLS (y sin recursión de políticas).
create function chofer_puede_agregar_lineas(p_trabajo uuid) returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from trabajos t
     where t.id = p_trabajo
       and t.creado_por = auth.uid()
       and (t.recibido_en at time zone 'America/Santiago')::date = hoy_chile()
       and not exists (select 1 from lineas l join movimientos m on m.linea_id = l.id where l.trabajo_id = t.id))
$$;
revoke execute on function chofer_puede_agregar_lineas(uuid) from public;
grant execute on function chofer_puede_agregar_lineas(uuid) to authenticated;

drop policy lineas_crear on lineas;
create policy lineas_crear on lineas for insert to authenticated
  with check (es_gestion() or (rol_actual() = 'chofer' and chofer_puede_agregar_lineas(trabajo_id)));

-- Movimientos: el chofer registra recepciones (origen NULL; el trigger limita a la primera etapa y a
-- la cantidad de la línea) y entregas (de una etapa "listo" a una final). No mueve dentro del taller.
create function chofer_puede_mover(p_origen uuid, p_destino uuid) returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select p_origen is null
      or (exists (select 1 from etapas where id = p_origen and es_listo)
          and exists (select 1 from etapas where id = p_destino and es_final))
$$;
revoke execute on function chofer_puede_mover(uuid, uuid) from public;
grant execute on function chofer_puede_mover(uuid, uuid) to authenticated;

drop policy movimientos_crear on movimientos;
create policy movimientos_crear on movimientos for insert to authenticated
  with check (
    usuario_id = auth.uid()
    and exists (select 1 from lineas l join trabajos t on t.id = l.trabajo_id
                where l.id = linea_id
                  and (es_gestion()
                       or area_del_operario() = t.area
                       or (rol_actual() = 'chofer' and chofer_puede_mover(etapa_origen_id, etapa_destino_id))))
  );

-- crear_trabajo: igual que en 0005, pero inserta todas las líneas y después los movimientos, para
-- que la política lineas_crear del chofer ("trabajo sin movimientos") acepte cada línea.
create or replace function crear_trabajo(p_datos jsonb) returns trabajos
  language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_cliente uuid;
  v_area area;
  v_entrada modalidad;
  v_salida modalidad;
  v_primera uuid;
  v_trabajo trabajos;
  v_linea_id uuid;
  v_ids uuid[] := '{}';
  v_cantidades integer[] := '{}';
  v_lineas jsonb;
  v_l jsonb;
  v_n integer;
  v_cantidad integer;
  v_txt text;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión para recibir trabajos.' using errcode = '42501';
  end if;
  if not (es_gestion() or rol_actual() = 'chofer') then
    raise exception 'No tienes permiso para recibir trabajos.' using errcode = '42501';
  end if;
  if p_datos is null or jsonb_typeof(p_datos) <> 'object' then
    raise exception 'Faltan los datos del trabajo.' using errcode = 'P0001';
  end if;

  v_txt := p_datos ->> 'cliente_id';
  if v_txt is null or v_txt !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'Elige el cliente.' using errcode = 'P0001';
  end if;
  v_cliente := v_txt::uuid;
  if not exists (select 1 from clientes where id = v_cliente) then
    raise exception 'El cliente no existe.' using errcode = 'P0001';
  end if;

  if (p_datos ->> 'area') not in ('afilado', 'encuadernacion') or p_datos ->> 'area' is null then
    raise exception 'Elige el área (afilado o encuadernación).' using errcode = 'P0001';
  end if;
  v_area := (p_datos ->> 'area')::area;

  if coalesce(p_datos ->> 'entrada', '') not in ('cliente', 'encomienda', 'ruta_propia') then
    raise exception 'Elige cómo llegó el trabajo.' using errcode = 'P0001';
  end if;
  v_entrada := (p_datos ->> 'entrada')::modalidad;
  if p_datos ->> 'salida' is null then
    v_salida := v_entrada;
  elsif p_datos ->> 'salida' in ('cliente', 'encomienda', 'ruta_propia') then
    v_salida := (p_datos ->> 'salida')::modalidad;
  else
    raise exception 'La modalidad de salida no es válida.' using errcode = 'P0001';
  end if;

  v_lineas := p_datos -> 'lineas';
  if v_lineas is null or jsonb_typeof(v_lineas) <> 'array' or jsonb_array_length(v_lineas) = 0 then
    raise exception 'Agrega al menos una línea.' using errcode = 'P0001';
  end if;

  v_n := 0;
  for v_l in select * from jsonb_array_elements(v_lineas) loop
    v_n := v_n + 1;
    if jsonb_typeof(v_l) <> 'object'
       or jsonb_typeof(v_l -> 'producto') is distinct from 'string'
       or btrim(v_l ->> 'producto') = '' then
      raise exception 'La línea % necesita un producto.', v_n using errcode = 'P0001';
    end if;
    if jsonb_typeof(v_l -> 'cantidad') is distinct from 'number'
       or (v_l ->> 'cantidad') !~ '^[0-9]{1,9}$'
       or (v_l ->> 'cantidad')::bigint < 1 or (v_l ->> 'cantidad')::bigint > 2147483647 then
      raise exception 'La cantidad de la línea % debe ser un número entero mayor que cero.', v_n
        using errcode = 'P0001';
    end if;
  end loop;

  select id into v_primera from etapas where area = v_area order by orden limit 1;
  if v_primera is null then
    raise exception 'El área no tiene etapas configuradas.' using errcode = 'P0001';
  end if;

  insert into trabajos (cliente_id, area, entrada, salida, urgente, guia_retiro, notas)
    values (v_cliente, v_area, v_entrada, v_salida,
            coalesce((p_datos ->> 'urgente') = 'true', false),
            nullif(btrim(p_datos ->> 'guia_retiro'), ''),
            nullif(btrim(p_datos ->> 'notas'), ''))
    returning * into v_trabajo;

  for v_l in select * from jsonb_array_elements(v_lineas) loop
    v_cantidad := (v_l ->> 'cantidad')::integer;
    insert into lineas (trabajo_id, producto, cantidad, nota)
      values (v_trabajo.id, btrim(v_l ->> 'producto'), v_cantidad, nullif(btrim(v_l ->> 'nota'), ''))
      returning id into v_linea_id;
    v_ids := v_ids || v_linea_id;
    v_cantidades := v_cantidades || v_cantidad;
  end loop;
  for i in 1 .. array_length(v_ids, 1) loop
    insert into movimientos (linea_id, cantidad, etapa_origen_id, etapa_destino_id, usuario_id)
      values (v_ids[i], v_cantidades[i], null, v_primera, auth.uid());
  end loop;

  return v_trabajo;
end $$;
revoke execute on function crear_trabajo(jsonb) from public;
grant execute on function crear_trabajo(jsonb) to authenticated;

-- =============================================================================================
-- Entregas
-- =============================================================================================

-- Agrega un N° de documento a la guía de despacho: separados por ", ", sin repetir uno que ya está.
-- (Igual que agregarDocumento en src/dominio/entrega.ts.)
create function agregar_documento(p_actual text, p_doc text) returns text
  language sql immutable set search_path = public, pg_temp as $$
  select case
    when nullif(btrim(p_actual), '') is null then p_doc
    when p_doc in (select btrim(x) from unnest(string_to_array(p_actual, ',')) x) then btrim(p_actual)
    else btrim(p_actual) || ', ' || p_doc
  end
$$;

-- Bloquea, en orden fijo (líneas por id y luego sus trabajos por id), lo que tocará una entrega.
-- Así dos entregas simultáneas que comparten líneas o trabajos se esperan en vez de bloquearse
-- mutuamente (deadlock), y el update de la guía no compite con el bloqueo compartido que toma el
-- trigger de movimientos. security definer porque un SELECT ... FOR UPDATE exige permiso de update
-- por RLS sobre lineas, que el chofer no tiene; solo bloquea, no devuelve datos.
create function bloquear_para_entrega(p_lineas uuid[]) returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not (es_gestion() or rol_actual() = 'chofer') then
    raise exception 'No tienes permiso para registrar entregas.' using errcode = '42501';
  end if;
  perform 1 from lineas where id = any(p_lineas) order by id for update;
  perform 1 from trabajos where id in (select trabajo_id from lineas where id = any(p_lineas)) order by id for update;
end $$;
revoke execute on function bloquear_para_entrega(uuid[]) from public;
grant execute on function bloquear_para_entrega(uuid[]) to authenticated;

-- entregar_unidades(p_entregas, p_documento): security invoker, así que RLS manda (lineas/trabajos
-- visibles, movimientos_crear con usuario_id = auth.uid(), trabajos_editar) y el trigger
-- movimientos_validar sigue validando cada movimiento. Una sola transacción: todo o nada.
-- p_entregas = [{linea_id: uuid, cantidad: entero > 0}, ...]; p_documento = N° de guía o factura.
-- Solo entrega unidades que están en una etapa "listo" del área (por orden de etapa) y las lleva a la
-- etapa final (la de menor orden si hubiera varias). Mismas reglas y mensajes que planificarEntrega.
create function entregar_unidades(p_entregas jsonb, p_documento text) returns void
  language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_e jsonb;
  v_doc text;
  v_ids uuid[];
  v_cantidades integer[];
  v_r record;
  v_et record;
  v_final uuid;
  v_disponibles integer;
  v_falta integer;
  v_toma integer;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión para registrar entregas.' using errcode = '42501';
  end if;
  if not (es_gestion() or rol_actual() = 'chofer') then
    raise exception 'No tienes permiso para registrar entregas.' using errcode = '42501';
  end if;

  -- 1. Validar la entrada completa antes de leer o bloquear nada.
  if p_entregas is null or jsonb_typeof(p_entregas) <> 'array' or jsonb_array_length(p_entregas) = 0 then
    raise exception 'Indica qué entregar.' using errcode = 'P0001';
  end if;
  for v_e in select * from jsonb_array_elements(p_entregas) loop
    if jsonb_typeof(v_e) <> 'object' or jsonb_typeof(v_e -> 'linea_id') is distinct from 'string'
       or v_e ->> 'linea_id' = '' then
      raise exception 'Falta la línea a entregar.' using errcode = 'P0001';
    end if;
    if jsonb_typeof(v_e -> 'cantidad') is distinct from 'number'
       or (v_e ->> 'cantidad') !~ '^[0-9]{1,10}$'
       or (v_e ->> 'cantidad')::bigint < 1 or (v_e ->> 'cantidad')::bigint > 2147483647 then
      raise exception 'La cantidad a entregar debe ser un número entero mayor que cero.' using errcode = 'P0001';
    end if;
  end loop;
  if (select count(distinct lower(e ->> 'linea_id')) from jsonb_array_elements(p_entregas) e)
     <> jsonb_array_length(p_entregas) then
    raise exception 'No repitas la misma línea en una entrega.' using errcode = 'P0001';
  end if;
  v_doc := btrim(coalesce(p_documento, ''));
  if v_doc = '' then
    raise exception 'Anota el número de guía o factura.' using errcode = 'P0001';
  end if;
  if char_length(v_doc) > 40 then
    raise exception 'El número de documento puede tener hasta 40 caracteres.' using errcode = 'P0001';
  end if;
  if strpos(v_doc, ',') > 0 then
    raise exception 'El número de documento no puede llevar comas.' using errcode = 'P0001';
  end if;
  if exists (select 1 from jsonb_array_elements(p_entregas) e
              where (e ->> 'linea_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
    raise exception 'La línea no existe.' using errcode = 'P0001';
  end if;

  select array_agg((e ->> 'linea_id')::uuid order by (e ->> 'linea_id')::uuid),
         array_agg((e ->> 'cantidad')::integer order by (e ->> 'linea_id')::uuid)
    into v_ids, v_cantidades
    from jsonb_array_elements(p_entregas) e;

  -- 2. Bloquear en orden fijo; desde aquí las cantidades leídas no pueden cambiar bajo nosotros.
  perform bloquear_para_entrega(v_ids);

  -- 3. Comprobar cada línea (en orden de id) antes de escribir nada.
  for v_r in
    select x.id, x.cantidad, l.producto, t.area
      from unnest(v_ids, v_cantidades) as x(id, cantidad)
      left join lineas l on l.id = x.id
      left join trabajos t on t.id = l.trabajo_id
     order by x.id
  loop
    if v_r.area is null then
      raise exception 'La línea no existe.' using errcode = 'P0001';
    end if;
    if not exists (select 1 from etapas where area = v_r.area and es_final) then
      raise exception 'El área no tiene una etapa de entrega configurada.' using errcode = 'P0001';
    end if;
    select coalesce(sum(greatest(unidades_en_etapa(v_r.id, e.id), 0)), 0) into v_disponibles
      from etapas e where e.area = v_r.area and e.es_listo;
    if v_r.cantidad > v_disponibles then
      raise exception '«%» tiene % %; no se pueden entregar % (faltan %).',
        v_r.producto, v_disponibles, case when v_disponibles = 1 then 'unidad lista' else 'unidades listas' end,
        v_r.cantidad, v_r.cantidad - v_disponibles
        using errcode = 'P0001';
    end if;
  end loop;

  -- 4. Registrar: de cada etapa "listo" (por orden) hacia la etapa final, hasta completar.
  for v_r in
    select x.id, x.cantidad, t.area
      from unnest(v_ids, v_cantidades) as x(id, cantidad)
      join lineas l on l.id = x.id join trabajos t on t.id = l.trabajo_id
     order by x.id
  loop
    select id into v_final from etapas where area = v_r.area and es_final order by orden limit 1;
    v_falta := v_r.cantidad;
    for v_et in select e.id, unidades_en_etapa(v_r.id, e.id) as n
                  from etapas e where e.area = v_r.area and e.es_listo order by e.orden loop
      v_toma := least(v_falta, greatest(v_et.n, 0));
      if v_toma > 0 then
        insert into movimientos (linea_id, cantidad, etapa_origen_id, etapa_destino_id, usuario_id)
          values (v_r.id, v_toma, v_et.id, v_final, auth.uid());
        v_falta := v_falta - v_toma;
      end if;
      exit when v_falta = 0;
    end loop;
  end loop;

  -- 5. Documento en la guía de despacho de cada trabajo tocado.
  update trabajos set guia_despacho = agregar_documento(guia_despacho, v_doc)
   where id in (select trabajo_id from lineas where id = any(v_ids));
end $$;
revoke execute on function entregar_unidades(jsonb, text) from public;
grant execute on function entregar_unidades(jsonb, text) to authenticated;

-- =============================================================================================
-- Visitas
-- =============================================================================================
-- Una visita por cliente y día (la app hace upsert sobre (fecha, cliente_id)). El recorrido es
-- informativo y opcional: la ruta se arma con el recorrido actual del cliente, y una visita extra
-- puede ser de un cliente sin recorrido.
alter table visitas alter column recorrido_id drop not null;
alter table visitas drop constraint visitas_recorrido_id_fkey;
alter table visitas add constraint visitas_recorrido_id_fkey
  foreign key (recorrido_id) references recorridos(id) on delete set null;
alter table visitas add constraint visitas_fecha_cliente_unica unique (fecha, cliente_id);
alter table visitas add constraint visitas_dia_habil check (extract(isodow from fecha) between 1 and 5);
alter table visitas add constraint visitas_nota_largo check (nota is null or char_length(nota) <= 200);

-- Gestión (secretaria, jefe, admin) administra todo (visitas_gestion, de 0001). El chofer lee
-- (visitas_ver) y marca su ruta: crea y actualiza visitas de hoy en adelante, nunca del pasado.
drop policy visitas_chofer_crea on visitas;
create policy visitas_chofer_crea on visitas for insert to authenticated
  with check (rol_actual() = 'chofer' and fecha >= hoy_chile());
create policy visitas_chofer_marca on visitas for update to authenticated
  using (rol_actual() = 'chofer' and fecha >= hoy_chile())
  with check (rol_actual() = 'chofer' and fecha >= hoy_chile());

-- ===== 0008_ajustes_finales.sql =====
-- Ajustes de la revisión final (nada desplegado aún; se aplica después de 0007).
--   * Correcciones: sacar unidades de una etapa de entrega (es_final) es solo para gestión.
--   * Entregas solo con documento: mover unidades HACIA una etapa final exige pasar por
--     entregar_unidades (que marca la transacción con app.entrega_ok), para todos los roles.
--   * Reintentos sin duplicar: crear_trabajo y entregar_unidades aceptan una clave de idempotencia
--     (uuid que genera la app por formulario); repetir la llamada con la misma clave no crea ni
--     entrega dos veces.
--   * Límites del chofer sobre trabajos: además de salida y guía de despacho puede anotar el
--     transporte (encomienda); la guía de despacho solo se completa (nunca se cambia ni se borra).
--   * Transporte de encomienda: hasta 120 caracteres, se anota al despachar.

-- =============================================================================================
-- Movimientos: misma lógica de 0005 + las dos reglas nuevas sobre etapas finales.
-- =============================================================================================
create or replace function movimientos_validar() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_area area;
  v_total integer;
  v_disponibles integer;
  v_recibidas integer;
begin
  select t.area, l.cantidad into v_area, v_total
    from lineas l join trabajos t on t.id = l.trabajo_id
   where l.id = new.linea_id
     for update of l for share of t;
  if not found then
    raise exception 'La línea no existe.' using errcode = 'P0001';
  end if;

  -- Usuario con sesión: debe poder mover esta área (evita revelar datos de otras áreas).
  if auth.uid() is not null
     and not (es_gestion() or rol_actual() = 'chofer' or area_del_operario() = v_area) then
    raise exception 'No tienes permiso para mover unidades de esta área.' using errcode = '42501';
  end if;

  if new.cantidad is null or new.cantidad <= 0 then
    raise exception 'La cantidad debe ser un número entero mayor que cero.' using errcode = 'P0001';
  end if;
  if new.etapa_origen_id is not distinct from new.etapa_destino_id then
    raise exception 'La etapa de origen y la de destino deben ser distintas.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from etapas where id = new.etapa_destino_id and area = v_area)
     or (new.etapa_origen_id is not null
         and not exists (select 1 from etapas where id = new.etapa_origen_id and area = v_area)) then
    raise exception 'Las etapas no corresponden al área del trabajo.' using errcode = 'P0001';
  end if;

  -- Corrección de una entrega (sacar unidades de una etapa final): solo gestión.
  if new.etapa_origen_id is not null and auth.uid() is not null and not es_gestion()
     and exists (select 1 from etapas where id = new.etapa_origen_id and es_final) then
    raise exception 'Solo secretaría, jefe de taller o administración pueden sacar unidades de una etapa de entrega.'
      using errcode = '42501';
  end if;
  -- Entregar (llevar unidades a una etapa final) solo con documento, es decir, por entregar_unidades.
  if coalesce(current_setting('app.entrega_ok', true), '') <> '1'
     and exists (select 1 from etapas where id = new.etapa_destino_id and es_final) then
    raise exception 'Las entregas se registran con «Entregar», anotando el número de guía o factura.'
      using errcode = 'P0001';
  end if;

  if new.etapa_origen_id is null then
    -- Recepción: solo hacia la primera etapa (menor orden) del área.
    if new.etapa_destino_id is distinct from
       (select id from etapas where area = v_area order by orden limit 1) then
      raise exception 'La recepción solo puede ir a la primera etapa del área.' using errcode = 'P0001';
    end if;
    select coalesce(sum(cantidad), 0) into v_recibidas
      from movimientos where linea_id = new.linea_id and etapa_origen_id is null;
    if v_recibidas + new.cantidad > v_total then
      raise exception 'La línea tiene % unidades y ya se recibieron %; no se pueden recibir % más.',
        v_total, v_recibidas, new.cantidad using errcode = 'P0001';
    end if;
  else
    v_disponibles := unidades_en_etapa(new.linea_id, new.etapa_origen_id);
    if new.cantidad > v_disponibles then
      raise exception 'Solo hay % % en esta etapa; no se pueden mover %.',
        v_disponibles, case when v_disponibles = 1 then 'unidad' else 'unidades' end, new.cantidad
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
revoke execute on function movimientos_validar() from public;

-- =============================================================================================
-- Trabajos: clave de idempotencia, largo del transporte y campos que puede tocar quien no es gestión.
-- =============================================================================================
alter table trabajos add column clave_idempotencia uuid;
alter table trabajos add constraint trabajos_clave_idempotencia_unica unique (clave_idempotencia);
alter table trabajos add constraint trabajos_transporte_largo
  check (transporte is null or char_length(transporte) <= 120);

-- Fuera de gestión (en la práctica el chofer) solo se cambian salida, guía de despacho y transporte, y
-- la guía de despacho solo se completa: queda igual o se le agrega ", <número>" al final (como hace
-- entregar_unidades). Sin sesión (migraciones, service role) no se limita.
create or replace function trabajos_limitar_campos() returns trigger
  language plpgsql set search_path = public, pg_temp as $$
declare
  v_antes text;
  v_nueva text;
begin
  if auth.uid() is null or es_gestion() then
    return new;
  end if;
  if (to_jsonb(new) - array['salida', 'guia_despacho', 'transporte'])
     is distinct from (to_jsonb(old) - array['salida', 'guia_despacho', 'transporte']) then
    raise exception 'Solo puedes cambiar la salida, la guía de despacho y el transporte de un trabajo.'
      using errcode = '42501';
  end if;
  v_antes := btrim(coalesce(old.guia_despacho, ''));
  v_nueva := btrim(coalesce(new.guia_despacho, ''));
  if v_antes <> '' and v_nueva <> v_antes and left(v_nueva, char_length(v_antes) + 2) <> v_antes || ', ' then
    raise exception 'La guía de despacho solo se puede completar: no se cambia ni se borra un número ya anotado.'
      using errcode = '42501';
  end if;
  return new;
end $$;
revoke execute on function trabajos_limitar_campos() from public;

-- crear_trabajo: igual que en 0007, más la clave opcional p_datos.clave (uuid). Si ya existe un
-- trabajo con esa clave creado por el mismo usuario (respuesta perdida y reintento), se devuelve ese
-- trabajo sin crear nada. Si la clave es de otro usuario, error (sin mostrar nada de ese trabajo).
-- Dos llamadas simultáneas con la misma clave: la segunda espera en el índice único a la primera.
create or replace function crear_trabajo(p_datos jsonb) returns trabajos
  language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_cliente uuid;
  v_area area;
  v_entrada modalidad;
  v_salida modalidad;
  v_primera uuid;
  v_trabajo trabajos;
  v_clave uuid;
  v_linea_id uuid;
  v_ids uuid[] := '{}';
  v_cantidades integer[] := '{}';
  v_lineas jsonb;
  v_l jsonb;
  v_n integer;
  v_cantidad integer;
  v_txt text;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión para recibir trabajos.' using errcode = '42501';
  end if;
  if not (es_gestion() or rol_actual() = 'chofer') then
    raise exception 'No tienes permiso para recibir trabajos.' using errcode = '42501';
  end if;
  if p_datos is null or jsonb_typeof(p_datos) <> 'object' then
    raise exception 'Faltan los datos del trabajo.' using errcode = 'P0001';
  end if;

  v_txt := p_datos ->> 'clave';
  if v_txt is not null then
    if v_txt !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'La clave de la solicitud no es válida.' using errcode = 'P0001';
    end if;
    v_clave := v_txt::uuid;
  end if;

  v_txt := p_datos ->> 'cliente_id';
  if v_txt is null or v_txt !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'Elige el cliente.' using errcode = 'P0001';
  end if;
  v_cliente := v_txt::uuid;
  if not exists (select 1 from clientes where id = v_cliente) then
    raise exception 'El cliente no existe.' using errcode = 'P0001';
  end if;

  if (p_datos ->> 'area') not in ('afilado', 'encuadernacion') or p_datos ->> 'area' is null then
    raise exception 'Elige el área (afilado o encuadernación).' using errcode = 'P0001';
  end if;
  v_area := (p_datos ->> 'area')::area;

  if coalesce(p_datos ->> 'entrada', '') not in ('cliente', 'encomienda', 'ruta_propia') then
    raise exception 'Elige cómo llegó el trabajo.' using errcode = 'P0001';
  end if;
  v_entrada := (p_datos ->> 'entrada')::modalidad;
  if p_datos ->> 'salida' is null then
    v_salida := v_entrada;
  elsif p_datos ->> 'salida' in ('cliente', 'encomienda', 'ruta_propia') then
    v_salida := (p_datos ->> 'salida')::modalidad;
  else
    raise exception 'La modalidad de salida no es válida.' using errcode = 'P0001';
  end if;

  v_lineas := p_datos -> 'lineas';
  if v_lineas is null or jsonb_typeof(v_lineas) <> 'array' or jsonb_array_length(v_lineas) = 0 then
    raise exception 'Agrega al menos una línea.' using errcode = 'P0001';
  end if;

  v_n := 0;
  for v_l in select * from jsonb_array_elements(v_lineas) loop
    v_n := v_n + 1;
    if jsonb_typeof(v_l) <> 'object'
       or jsonb_typeof(v_l -> 'producto') is distinct from 'string'
       or btrim(v_l ->> 'producto') = '' then
      raise exception 'La línea % necesita un producto.', v_n using errcode = 'P0001';
    end if;
    if jsonb_typeof(v_l -> 'cantidad') is distinct from 'number'
       or (v_l ->> 'cantidad') !~ '^[0-9]{1,9}$'
       or (v_l ->> 'cantidad')::bigint < 1 or (v_l ->> 'cantidad')::bigint > 2147483647 then
      raise exception 'La cantidad de la línea % debe ser un número entero mayor que cero.', v_n
        using errcode = 'P0001';
    end if;
  end loop;

  select id into v_primera from etapas where area = v_area order by orden limit 1;
  if v_primera is null then
    raise exception 'El área no tiene etapas configuradas.' using errcode = 'P0001';
  end if;

  insert into trabajos (cliente_id, area, entrada, salida, urgente, guia_retiro, notas, clave_idempotencia)
    values (v_cliente, v_area, v_entrada, v_salida,
            coalesce((p_datos ->> 'urgente') = 'true', false),
            nullif(btrim(p_datos ->> 'guia_retiro'), ''),
            nullif(btrim(p_datos ->> 'notas'), ''),
            v_clave)
    on conflict (clave_idempotencia) do nothing
    returning * into v_trabajo;
  if v_trabajo.id is null then
    -- La clave ya se usó: es un reintento del mismo usuario (se devuelve lo ya creado) o un error.
    select * into v_trabajo from trabajos where clave_idempotencia = v_clave;
    if v_trabajo.id is null or v_trabajo.creado_por is distinct from auth.uid() then
      raise exception 'Esta recepción no se pudo guardar. Cierra el formulario, ábrelo de nuevo e inténtalo otra vez.'
        using errcode = 'P0001';
    end if;
    return v_trabajo;
  end if;

  for v_l in select * from jsonb_array_elements(v_lineas) loop
    v_cantidad := (v_l ->> 'cantidad')::integer;
    insert into lineas (trabajo_id, producto, cantidad, nota)
      values (v_trabajo.id, btrim(v_l ->> 'producto'), v_cantidad, nullif(btrim(v_l ->> 'nota'), ''))
      returning id into v_linea_id;
    v_ids := v_ids || v_linea_id;
    v_cantidades := v_cantidades || v_cantidad;
  end loop;
  for i in 1 .. array_length(v_ids, 1) loop
    insert into movimientos (linea_id, cantidad, etapa_origen_id, etapa_destino_id, usuario_id)
      values (v_ids[i], v_cantidades[i], null, v_primera, auth.uid());
  end loop;

  return v_trabajo;
end $$;
revoke execute on function crear_trabajo(jsonb) from public;
grant execute on function crear_trabajo(jsonb) to authenticated;

-- =============================================================================================
-- Entregas: clave de idempotencia y transporte.
-- =============================================================================================
-- Claves de entregas ya registradas. Nadie la lee ni escribe directo (RLS sin políticas): solo
-- reclamar_clave_entrega (security definer). Guarda lo entregado para reconocer un reintento.
create table entregas_registradas (
  clave uuid primary key,
  usuario_id uuid not null references auth.users(id) on delete cascade,
  creado_en timestamptz not null default now(),
  documento text not null,
  entregas jsonb not null
);
alter table entregas_registradas enable row level security;

-- Reserva la clave para el usuario de la sesión dentro de la transacción de la entrega (si la entrega
-- falla, la reserva se deshace con ella). Devuelve true si la clave es nueva y false si el mismo
-- usuario ya registró esa misma entrega (reintento: no hay que hacer nada). Una segunda llamada
-- simultánea espera en la clave primaria a que la primera termine.
create function reclamar_clave_entrega(p_clave uuid, p_documento text, p_entregas jsonb) returns boolean
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_fila entregas_registradas;
begin
  insert into entregas_registradas (clave, usuario_id, documento, entregas)
    values (p_clave, auth.uid(), p_documento, p_entregas)
    on conflict (clave) do nothing;
  if found then
    return true;
  end if;
  select * into v_fila from entregas_registradas where clave = p_clave;
  if v_fila.usuario_id is distinct from auth.uid()
     or v_fila.documento is distinct from p_documento or v_fila.entregas is distinct from p_entregas then
    raise exception 'Esta entrega no se pudo registrar. Cierra el panel, ábrelo de nuevo y revisa lo que ya quedó entregado.'
      using errcode = 'P0001';
  end if;
  return false;
end $$;
revoke execute on function reclamar_clave_entrega(uuid, text, jsonb) from public;
grant execute on function reclamar_clave_entrega(uuid, text, jsonb) to authenticated;

-- Se reemplaza la firma de 0007 (dos argumentos) por una con clave y transporte opcionales; dejar
-- ambas haría ambigua la llamada por nombre de PostgREST.
drop function entregar_unidades(jsonb, text);

-- entregar_unidades(p_entregas, p_documento, p_clave, p_transporte): igual que en 0007, más:
--   * p_clave (opcional): si este usuario ya registró esta misma entrega con esa clave, no hace nada;
--   * p_transporte (opcional, hasta 120 caracteres): se anota en el transporte de cada trabajo tocado;
--   * marca la transacción (app.entrega_ok) para que movimientos_validar acepte el paso a la etapa final.
create function entregar_unidades(p_entregas jsonb, p_documento text, p_clave uuid default null,
                                  p_transporte text default null) returns void
  language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_e jsonb;
  v_doc text;
  v_transporte text;
  v_ids uuid[];
  v_cantidades integer[];
  v_r record;
  v_et record;
  v_final uuid;
  v_disponibles integer;
  v_falta integer;
  v_toma integer;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión para registrar entregas.' using errcode = '42501';
  end if;
  if not (es_gestion() or rol_actual() = 'chofer') then
    raise exception 'No tienes permiso para registrar entregas.' using errcode = '42501';
  end if;

  -- 1. Validar la entrada completa antes de leer o bloquear nada.
  if p_entregas is null or jsonb_typeof(p_entregas) <> 'array' or jsonb_array_length(p_entregas) = 0 then
    raise exception 'Indica qué entregar.' using errcode = 'P0001';
  end if;
  for v_e in select * from jsonb_array_elements(p_entregas) loop
    if jsonb_typeof(v_e) <> 'object' or jsonb_typeof(v_e -> 'linea_id') is distinct from 'string'
       or v_e ->> 'linea_id' = '' then
      raise exception 'Falta la línea a entregar.' using errcode = 'P0001';
    end if;
    if jsonb_typeof(v_e -> 'cantidad') is distinct from 'number'
       or (v_e ->> 'cantidad') !~ '^[0-9]{1,10}$'
       or (v_e ->> 'cantidad')::bigint < 1 or (v_e ->> 'cantidad')::bigint > 2147483647 then
      raise exception 'La cantidad a entregar debe ser un número entero mayor que cero.' using errcode = 'P0001';
    end if;
  end loop;
  if (select count(distinct lower(e ->> 'linea_id')) from jsonb_array_elements(p_entregas) e)
     <> jsonb_array_length(p_entregas) then
    raise exception 'No repitas la misma línea en una entrega.' using errcode = 'P0001';
  end if;
  v_doc := btrim(coalesce(p_documento, ''));
  if v_doc = '' then
    raise exception 'Anota el número de guía o factura.' using errcode = 'P0001';
  end if;
  if char_length(v_doc) > 40 then
    raise exception 'El número de documento puede tener hasta 40 caracteres.' using errcode = 'P0001';
  end if;
  if strpos(v_doc, ',') > 0 then
    raise exception 'El número de documento no puede llevar comas.' using errcode = 'P0001';
  end if;
  v_transporte := nullif(btrim(coalesce(p_transporte, '')), '');
  if char_length(v_transporte) > 120 then
    raise exception 'El transporte puede tener hasta 120 caracteres.' using errcode = 'P0001';
  end if;
  if exists (select 1 from jsonb_array_elements(p_entregas) e
              where (e ->> 'linea_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
    raise exception 'La línea no existe.' using errcode = 'P0001';
  end if;

  select array_agg((e ->> 'linea_id')::uuid order by (e ->> 'linea_id')::uuid),
         array_agg((e ->> 'cantidad')::integer order by (e ->> 'linea_id')::uuid)
    into v_ids, v_cantidades
    from jsonb_array_elements(p_entregas) e;

  -- 2. Reintento: la misma entrega con la misma clave ya quedó registrada -> no se hace nada.
  if p_clave is not null
     and not reclamar_clave_entrega(p_clave, v_doc,
               (select jsonb_agg(jsonb_build_array(x.id, x.cantidad) order by x.id)
                  from unnest(v_ids, v_cantidades) as x(id, cantidad))) then
    return;
  end if;

  -- 3. Bloquear en orden fijo; desde aquí las cantidades leídas no pueden cambiar bajo nosotros.
  perform bloquear_para_entrega(v_ids);

  -- 4. Comprobar cada línea (en orden de id) antes de escribir nada.
  for v_r in
    select x.id, x.cantidad, l.producto, t.area
      from unnest(v_ids, v_cantidades) as x(id, cantidad)
      left join lineas l on l.id = x.id
      left join trabajos t on t.id = l.trabajo_id
     order by x.id
  loop
    if v_r.area is null then
      raise exception 'La línea no existe.' using errcode = 'P0001';
    end if;
    if not exists (select 1 from etapas where area = v_r.area and es_final) then
      raise exception 'El área no tiene una etapa de entrega configurada.' using errcode = 'P0001';
    end if;
    select coalesce(sum(greatest(unidades_en_etapa(v_r.id, e.id), 0)), 0) into v_disponibles
      from etapas e where e.area = v_r.area and e.es_listo;
    if v_r.cantidad > v_disponibles then
      raise exception '«%» tiene % %; no se pueden entregar % (faltan %).',
        v_r.producto, v_disponibles, case when v_disponibles = 1 then 'unidad lista' else 'unidades listas' end,
        v_r.cantidad, v_r.cantidad - v_disponibles
        using errcode = 'P0001';
    end if;
  end loop;

  -- 5. Registrar: de cada etapa "listo" (por orden) hacia la etapa final, hasta completar. Solo aquí
  --    la transacción queda autorizada a llevar unidades a la etapa final.
  perform set_config('app.entrega_ok', '1', true);
  for v_r in
    select x.id, x.cantidad, t.area
      from unnest(v_ids, v_cantidades) as x(id, cantidad)
      join lineas l on l.id = x.id join trabajos t on t.id = l.trabajo_id
     order by x.id
  loop
    select id into v_final from etapas where area = v_r.area and es_final order by orden limit 1;
    v_falta := v_r.cantidad;
    for v_et in select e.id, unidades_en_etapa(v_r.id, e.id) as n
                  from etapas e where e.area = v_r.area and e.es_listo order by e.orden loop
      v_toma := least(v_falta, greatest(v_et.n, 0));
      if v_toma > 0 then
        insert into movimientos (linea_id, cantidad, etapa_origen_id, etapa_destino_id, usuario_id)
          values (v_r.id, v_toma, v_et.id, v_final, auth.uid());
        v_falta := v_falta - v_toma;
      end if;
      exit when v_falta = 0;
    end loop;
  end loop;
  perform set_config('app.entrega_ok', '', true);

  -- 6. Documento en la guía de despacho (y transporte, si se indicó) de cada trabajo tocado.
  update trabajos set guia_despacho = agregar_documento(guia_despacho, v_doc),
                      transporte = coalesce(v_transporte, transporte)
   where id in (select trabajo_id from lineas where id = any(v_ids));
end $$;
revoke execute on function entregar_unidades(jsonb, text, uuid, text) from public;
grant execute on function entregar_unidades(jsonb, text, uuid, text) to authenticated;

-- ===== 0009_cliente_recorridos.sql =====
-- Trazabilidad: un cliente puede estar en varios recorridos (spec §5.2, "Recorridos múltiples y
-- visitas a pedido"). La hoja real tiene 10 recorridos (lunes a viernes, dos choferes titulares) y
-- muchos clientes salen en 2 o 3 días. Reemplaza clientes.recorrido_id (un solo recorrido y día).

-- Chofer titular del recorrido (nombre para mostrar, p. ej. "Rodrigo Lagos"); opcional. La Hoja de
-- ruta elige por defecto el recorrido del día cuyo chofer coincide con el nombre del perfil.
alter table recorridos add column chofer text;
alter table recorridos add constraint recorridos_chofer_largo check (chofer is null or char_length(chofer) <= 120);

-- fija = true: se visita siempre ese día (si no hay nada que entregar, sale en "Pasar a retirar").
-- fija = false ("a pedido", los nombres entre paréntesis de la hoja): sale ese día solo si tiene algo
-- listo para entregar por ruta propia o una visita solicitada o confirmada "sí".
-- orden: orden sugerido de visita dentro del recorrido (el chofer decide el orden real cada día).
create table cliente_recorridos (
  cliente_id uuid not null references clientes(id) on delete cascade,
  recorrido_id uuid not null references recorridos(id) on delete cascade,
  fija boolean not null default true,
  orden integer not null default 0,
  primary key (cliente_id, recorrido_id),
  constraint cliente_recorridos_orden_positivo check (orden >= 0)
);
create index on cliente_recorridos (recorrido_id);

-- Las asignaciones que ya existían pasan como fijas (antes cada cliente se visitaba en su día).
insert into cliente_recorridos (cliente_id, recorrido_id, fija, orden)
  select id, recorrido_id, true, 0 from clientes where recorrido_id is not null;

alter table clientes drop column recorrido_id;

-- RLS: todos los usuarios con perfil leen (la ruta y "Qué hay listo" las usan); solo gestión
-- (administración, secretaría, jefe de taller) asigna, cambia o quita. Chofer y operarios solo leen.
alter table cliente_recorridos enable row level security;
create policy cliente_recorridos_ver on cliente_recorridos for select to authenticated
  using (rol_actual() is not null);
create policy cliente_recorridos_gestion on cliente_recorridos for all to authenticated
  using (es_gestion()) with check (es_gestion());

-- ===== 0010_detalle_y_planificacion.sql =====
-- Trazabilidad, Task 11 (cambio de requisito 2 del dueño):
-- (a) el chofer retira y solo anota el tipo/tamaño de la herramienta; el servicio y el detalle técnico
--     (ángulo, melladura, dientes, terminación…) los define el taller, por línea;
-- (b) en ENCUADERNACIÓN hay hora planificada de entrega del trabajo completo Y de cada entrega parcial.
-- Las horas planificadas son hora de reloj de Chile (timestamp sin zona): "el jueves a las 15:00".

-- ---------------------------------------------------------------------------------------------
-- Catálogo: tipo de producto. Lo existente queda como herramienta (lo que se importó hasta hoy).
-- ---------------------------------------------------------------------------------------------
alter table productos add column tipo text not null default 'herramienta';
alter table productos add constraint productos_tipo_valido check (tipo in ('herramienta', 'servicio'));

-- ---------------------------------------------------------------------------------------------
-- Líneas: servicio y detalle del taller (opcionales).
-- ---------------------------------------------------------------------------------------------
alter table lineas add column servicio text;
alter table lineas add column detalle_taller text;
alter table lineas add constraint lineas_servicio_largo
  check (servicio is null or (btrim(servicio) <> '' and char_length(servicio) <= 200));
alter table lineas add constraint lineas_detalle_largo
  check (detalle_taller is null or (btrim(detalle_taller) <> '' and char_length(detalle_taller) <= 1000));

-- ---------------------------------------------------------------------------------------------
-- Trabajos: hora planificada de la entrega completa (solo encuadernación).
-- ---------------------------------------------------------------------------------------------
alter table trabajos add column entrega_planificada timestamp;
alter table trabajos add constraint trabajos_planificada_encuadernacion
  check (entrega_planificada is null or area = 'encuadernacion');

-- Entregas parciales planificadas: hora, cantidad opcional y nota. Se escriben solo con
-- planificar_entregas (que reemplaza todas las del trabajo de una vez).
create table entregas_parciales (
  id uuid primary key default gen_random_uuid(),
  trabajo_id uuid not null references trabajos(id) on delete cascade,
  planificada timestamp not null,
  cantidad integer check (cantidad is null or cantidad > 0),
  nota text check (nota is null or (btrim(nota) <> '' and char_length(nota) <= 200))
);
create index on entregas_parciales (trabajo_id);

alter table entregas_parciales enable row level security;
-- Se leen como el trabajo (operarios su área; gestión y chofer todo). Sin políticas de escritura.
create policy entregas_parciales_ver on entregas_parciales for select to authenticated
  using (exists (select 1 from trabajos t where t.id = trabajo_id and puede_ver_area(t.area)));

-- ---------------------------------------------------------------------------------------------
-- trabajos_limitar_campos (0008) + entrega_planificada: fuera de gestión, solo el operario de
-- encuadernación puede cambiarla (y solo llega por planificar_entregas: no tiene update por RLS).
-- El chofer sigue limitado a salida, guía de despacho y transporte.
-- ---------------------------------------------------------------------------------------------
create or replace function trabajos_limitar_campos() returns trigger
  language plpgsql set search_path = public, pg_temp as $$
declare
  v_antes text;
  v_nueva text;
  v_libres text[] := array['salida', 'guia_despacho', 'transporte'];
begin
  if auth.uid() is null or es_gestion() then
    return new;
  end if;
  if rol_actual() = 'operario_encuadernacion' then
    v_libres := array['entrega_planificada'];
  end if;
  if (to_jsonb(new) - v_libres) is distinct from (to_jsonb(old) - v_libres) then
    if rol_actual() = 'operario_encuadernacion' then
      raise exception 'Solo puedes cambiar la hora planificada de entrega de un trabajo.' using errcode = '42501';
    end if;
    raise exception 'Solo puedes cambiar la salida, la guía de despacho y el transporte de un trabajo.'
      using errcode = '42501';
  end if;
  v_antes := btrim(coalesce(old.guia_despacho, ''));
  v_nueva := btrim(coalesce(new.guia_despacho, ''));
  if v_antes <> '' and v_nueva <> v_antes and left(v_nueva, char_length(v_antes) + 2) <> v_antes || ', ' then
    raise exception 'La guía de despacho solo se puede completar: no se cambia ni se borra un número ya anotado.'
      using errcode = '42501';
  end if;
  return new;
end $$;
revoke execute on function trabajos_limitar_campos() from public;

-- ---------------------------------------------------------------------------------------------
-- guardar_detalle_linea: gestión o el operario del área de la línea. security definer porque los
-- operarios no tienen update sobre lineas por RLS; solo toca servicio y detalle_taller.
-- Texto vacío = sin dato.
-- ---------------------------------------------------------------------------------------------
create function guardar_detalle_linea(p_linea uuid, p_servicio text, p_detalle text) returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_area area;
  v_servicio text := nullif(btrim(coalesce(p_servicio, '')), '');
  v_detalle text := nullif(btrim(coalesce(p_detalle, '')), '');
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión para guardar el detalle.' using errcode = '42501';
  end if;
  select t.area into v_area from lineas l join trabajos t on t.id = l.trabajo_id where l.id = p_linea;
  if not found then
    raise exception 'La línea no existe.' using errcode = 'P0001';
  end if;
  if not coalesce(es_gestion() or area_del_operario() = v_area, false) then
    raise exception 'No tienes permiso para cambiar el detalle de esta línea.' using errcode = '42501';
  end if;
  if char_length(v_servicio) > 200 then
    raise exception 'El servicio puede tener hasta 200 caracteres.' using errcode = 'P0001';
  end if;
  if char_length(v_detalle) > 1000 then
    raise exception 'El detalle puede tener hasta 1000 caracteres.' using errcode = 'P0001';
  end if;
  update lineas set servicio = v_servicio, detalle_taller = v_detalle where id = p_linea;
end $$;
revoke execute on function guardar_detalle_linea(uuid, text, text) from public, anon;
grant execute on function guardar_detalle_linea(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- planificar_entregas: reemplaza, todo o nada, la hora del trabajo y sus entregas parciales.
-- Gestión u operario de encuadernación; solo trabajos de encuadernación. Bloquea el trabajo para que
-- dos planificaciones simultáneas no se mezclen. p_parciales = [{planificada, cantidad?, nota?}, ...]
-- ---------------------------------------------------------------------------------------------
create function planificar_entregas(p_trabajo uuid, p_entrega timestamp, p_parciales jsonb) returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_area area;
  v_total integer;
  v_suma integer := 0;
  v_p jsonb;
  v_n integer := 0;
  v_cantidad integer;
  v_nota text;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión para planificar entregas.' using errcode = '42501';
  end if;
  if not coalesce(es_gestion() or rol_actual() = 'operario_encuadernacion', false) then
    raise exception 'No tienes permiso para planificar entregas.' using errcode = '42501';
  end if;
  select area into v_area from trabajos where id = p_trabajo for update;
  if not found then
    raise exception 'El trabajo no existe.' using errcode = 'P0001';
  end if;
  if v_area <> 'encuadernacion' then
    raise exception 'Solo los trabajos de encuadernación tienen hora planificada.' using errcode = 'P0001';
  end if;
  p_parciales := coalesce(p_parciales, '[]'::jsonb);
  if jsonb_typeof(p_parciales) <> 'array' then
    raise exception 'Las entregas parciales no son válidas.' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_parciales) > 50 then
    raise exception 'Se pueden planificar hasta 50 entregas parciales.' using errcode = 'P0001';
  end if;
  select coalesce(sum(cantidad), 0) into v_total from lineas where trabajo_id = p_trabajo;

  update trabajos set entrega_planificada = p_entrega where id = p_trabajo;
  delete from entregas_parciales where trabajo_id = p_trabajo;
  for v_p in select * from jsonb_array_elements(p_parciales) loop
    v_n := v_n + 1;
    if nullif(v_p ->> 'planificada', '') is null then
      raise exception 'Falta la fecha y hora de la entrega parcial %.', v_n using errcode = 'P0001';
    end if;
    v_cantidad := (v_p ->> 'cantidad')::integer;
    if v_cantidad is not null and v_cantidad <= 0 then
      raise exception 'La cantidad de la entrega parcial % debe ser un número entero mayor que cero.', v_n using errcode = 'P0001';
    end if;
    v_nota := nullif(btrim(coalesce(v_p ->> 'nota', '')), '');
    if char_length(v_nota) > 200 then
      raise exception 'La nota de la entrega parcial % puede tener hasta 200 caracteres.', v_n using errcode = 'P0001';
    end if;
    v_suma := v_suma + coalesce(v_cantidad, 0);
    insert into entregas_parciales (trabajo_id, planificada, cantidad, nota)
      values (p_trabajo, (v_p ->> 'planificada')::timestamp, v_cantidad, v_nota);
  end loop;
  if v_suma > v_total then
    raise exception 'Las entregas parciales suman % unidades, pero el trabajo tiene %.', v_suma, v_total using errcode = 'P0001';
  end if;
end $$;
revoke execute on function planificar_entregas(uuid, timestamp, jsonb) from public, anon;
grant execute on function planificar_entregas(uuid, timestamp, jsonb) to authenticated;


-- ===== 0011_editar_trabajo.sql =====
-- Editar un trabajo mientras sigue en Recepción (pedido del dueño, 2026-11-27).
-- Mientras NINGUNA pieza del trabajo pasó al taller (todos sus movimientos son la recepción inicial,
-- sin etapa de origen), gestión puede cambiar el cliente, urgente, la guía de retiro, las notas y las
-- líneas: agregar, quitar, cambiar producto, cantidad y detalle (lineas.nota). El área no cambia.
-- Todo o nada, en una sola llamada.
--
-- editar_trabajo(p_trabajo, p_datos): p_datos = {cliente_id, urgente?, guia_retiro?, notas?,
--   lineas: [{id?, producto, cantidad, nota?}, ...]}. Línea con id = línea existente del trabajo;
--   sin id = línea nueva. Las líneas del trabajo que no vienen se borran (con su recepción inicial).
-- security definer: borrar y rehacer la recepción inicial necesita tocar movimientos, que no tiene
-- políticas de update ni delete. Quién puede llamar se revisa adentro (solo gestión).
-- Concurrencia: bloquea el trabajo (for update). movimientos_validar comparte esa fila (for share),
-- así que un movimiento al taller simultáneo espera a la edición, o la edición lo ve y se rechaza.

create function editar_trabajo(p_trabajo uuid, p_datos jsonb) returns trabajos
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_trabajo trabajos;
  v_cliente uuid;
  v_primera uuid;
  v_lineas jsonb;
  v_l jsonb;
  v_n integer;
  v_txt text;
  v_id uuid;
  v_ids uuid[] := '{}';
  v_cantidad integer;
  v_total integer := 0;
  v_planificadas integer;
  v_usuario uuid;
  v_creado timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión para editar trabajos.' using errcode = '42501';
  end if;
  if not coalesce(es_gestion(), false) then
    raise exception 'No tienes permiso para editar trabajos.' using errcode = '42501';
  end if;
  if p_datos is null or jsonb_typeof(p_datos) <> 'object' then
    raise exception 'Faltan los datos del trabajo.' using errcode = 'P0001';
  end if;

  select * into v_trabajo from trabajos where id = p_trabajo for update;
  if not found then
    raise exception 'El trabajo no existe.' using errcode = 'P0001';
  end if;
  if exists (select 1 from movimientos m join lineas l on l.id = m.linea_id
              where l.trabajo_id = p_trabajo and m.etapa_origen_id is not null) then
    raise exception 'Este trabajo ya tiene piezas en el taller: ya no se puede editar desde Recepción.'
      using errcode = 'P0001';
  end if;

  v_txt := p_datos ->> 'cliente_id';
  if v_txt is null or v_txt !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'Elige el cliente.' using errcode = 'P0001';
  end if;
  v_cliente := v_txt::uuid;
  if not exists (select 1 from clientes where id = v_cliente) then
    raise exception 'El cliente no existe.' using errcode = 'P0001';
  end if;

  v_lineas := p_datos -> 'lineas';
  if v_lineas is null or jsonb_typeof(v_lineas) <> 'array' or jsonb_array_length(v_lineas) = 0 then
    raise exception 'Agrega al menos una línea.' using errcode = 'P0001';
  end if;

  -- Validar todas las líneas antes de tocar nada.
  v_n := 0;
  for v_l in select * from jsonb_array_elements(v_lineas) loop
    v_n := v_n + 1;
    if jsonb_typeof(v_l) <> 'object'
       or jsonb_typeof(v_l -> 'producto') is distinct from 'string'
       or btrim(v_l ->> 'producto') = '' then
      raise exception 'La línea % necesita un producto.', v_n using errcode = 'P0001';
    end if;
    if jsonb_typeof(v_l -> 'cantidad') is distinct from 'number'
       or (v_l ->> 'cantidad') !~ '^[0-9]{1,9}$'
       or (v_l ->> 'cantidad')::bigint < 1 or (v_l ->> 'cantidad')::bigint > 2147483647 then
      raise exception 'La cantidad de la línea % debe ser un número entero mayor que cero.', v_n
        using errcode = 'P0001';
    end if;
    v_total := v_total + (v_l ->> 'cantidad')::integer;
    v_txt := v_l ->> 'id';
    if v_txt is not null then
      if v_txt !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         or not exists (select 1 from lineas where id = v_txt::uuid and trabajo_id = p_trabajo) then
        raise exception 'La línea % no es de este trabajo.', v_n using errcode = 'P0001';
      end if;
      if v_txt::uuid = any (v_ids) then
        raise exception 'La línea % está repetida.', v_n using errcode = 'P0001';
      end if;
      v_ids := v_ids || v_txt::uuid;
    end if;
  end loop;

  select coalesce(sum(cantidad), 0) into v_planificadas from entregas_parciales where trabajo_id = p_trabajo;
  if v_planificadas > v_total then
    raise exception 'Las entregas parciales planificadas suman % unidades, pero el trabajo quedaría con %. Ajusta primero la planificación.',
      v_planificadas, v_total using errcode = 'P0001';
  end if;

  select id into v_primera from etapas where area = v_trabajo.area order by orden limit 1;
  if v_primera is null then
    raise exception 'El área no tiene etapas configuradas.' using errcode = 'P0001';
  end if;

  -- Líneas quitadas: se borra su recepción inicial y luego la línea.
  delete from movimientos m using lineas l
   where l.id = m.linea_id and l.trabajo_id = p_trabajo and not (l.id = any (v_ids));
  delete from lineas where trabajo_id = p_trabajo and not (id = any (v_ids));

  for v_l in select * from jsonb_array_elements(v_lineas) loop
    v_cantidad := (v_l ->> 'cantidad')::integer;
    if v_l ->> 'id' is not null then
      v_id := (v_l ->> 'id')::uuid;
      -- La recepción inicial se rehace con la nueva cantidad, conservando quién y cuándo recibió.
      select usuario_id, creado_en into v_usuario, v_creado
        from movimientos where linea_id = v_id order by creado_en limit 1;
      delete from movimientos where linea_id = v_id;
      update lineas set producto = btrim(v_l ->> 'producto'), cantidad = v_cantidad,
                        nota = nullif(btrim(v_l ->> 'nota'), '')
       where id = v_id;
      insert into movimientos (linea_id, cantidad, etapa_origen_id, etapa_destino_id, usuario_id, creado_en)
        values (v_id, v_cantidad, null, v_primera, coalesce(v_usuario, auth.uid()), coalesce(v_creado, now()));
    else
      insert into lineas (trabajo_id, producto, cantidad, nota)
        values (p_trabajo, btrim(v_l ->> 'producto'), v_cantidad, nullif(btrim(v_l ->> 'nota'), ''))
        returning id into v_id;
      insert into movimientos (linea_id, cantidad, etapa_origen_id, etapa_destino_id, usuario_id)
        values (v_id, v_cantidad, null, v_primera, auth.uid());
    end if;
  end loop;

  update trabajos
     set cliente_id = v_cliente,
         urgente = coalesce((p_datos ->> 'urgente') = 'true', false),
         guia_retiro = nullif(btrim(p_datos ->> 'guia_retiro'), ''),
         notas = nullif(btrim(p_datos ->> 'notas'), '')
   where id = p_trabajo
   returning * into v_trabajo;
  return v_trabajo;
end $$;
revoke execute on function editar_trabajo(uuid, jsonb) from public, anon;
grant execute on function editar_trabajo(uuid, jsonb) to authenticated;

-- ===== 0012_numero_por_area.sql =====
-- Numeración separada por área (pedido del dueño, 2026-11-27).
-- Cada área lleva su propio correlativo: Afilado A-001, A-002…; Encuadernación E-001, E-002…
-- La app muestra el código (letra del área + numero_area con tres cifras). trabajos.numero (identity
-- global) se queda como número interno y no se muestra.
--
-- Trabajos existentes: se numeran por área en el orden en que se recibieron (recibido_en, y numero
-- para desempatar), así el más antiguo de cada área queda con el 1.
--
-- Trabajos nuevos: un trigger before insert toma el siguiente número del contador de su área
-- (contadores_area). El update ... returning bloquea la fila del contador, así que dos recepciones
-- simultáneas de la misma área nunca reciben el mismo número. El número no se puede cambiar después.

alter table trabajos add column numero_area integer;

with orden as (
  select id, row_number() over (partition by area order by recibido_en, numero) as n
  from trabajos
)
update trabajos t set numero_area = orden.n from orden where orden.id = t.id;

create table contadores_area (
  area area primary key,
  ultimo integer not null default 0
);
alter table contadores_area enable row level security;
-- Sin políticas: solo el trigger (security definer) lo lee y lo cambia.

insert into contadores_area (area, ultimo)
select a.area, coalesce((select max(t.numero_area) from trabajos t where t.area = a.area), 0)
from (values ('afilado'::area), ('encuadernacion'::area)) as a(area);

create function trabajos_numerar() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update contadores_area set ultimo = ultimo + 1 where area = new.area
    returning ultimo into new.numero_area;
  if new.numero_area is null then
    insert into contadores_area (area, ultimo) values (new.area, 1)
      on conflict (area) do update set ultimo = contadores_area.ultimo + 1
      returning ultimo into new.numero_area;
  end if;
  return new;
end $$;
revoke execute on function trabajos_numerar() from public;
create trigger trabajos_numerar before insert on trabajos
  for each row execute function trabajos_numerar();

create function trabajos_numero_fijo() returns trigger
  language plpgsql set search_path = public, pg_temp as $$
begin
  if new.numero_area is distinct from old.numero_area then
    raise exception 'El número de un trabajo no se puede cambiar.' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke execute on function trabajos_numero_fijo() from public;
create trigger trabajos_numero_fijo before update on trabajos
  for each row execute function trabajos_numero_fijo();

alter table trabajos alter column numero_area set not null;
alter table trabajos add constraint trabajos_numero_area_unico unique (area, numero_area);
