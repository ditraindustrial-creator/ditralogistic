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
