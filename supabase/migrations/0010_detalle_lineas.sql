-- 0010_detalle_lineas.sql
-- Detalle técnico por línea: tipo de producto (herramienta/servicio), servicio referenciado y
-- texto libre de taller. Los operarios del área y la gestión pueden actualizar el detalle.

-- Tipo de producto: NULL = sin clasificar (válido para ambas áreas)
alter table productos
  add column tipo text check (tipo in ('herramienta', 'servicio'));

-- Referencia a un producto de tipo 'servicio' (opcional, solo encuadernación en la UI)
alter table lineas
  add column servicio_id uuid references productos(id) on delete set null;

-- Texto libre de taller: ángulo, melladura, dientes, etc.
alter table lineas
  add column detalle_taller text;

-- ------------------------------------------------------------------------------------------
-- actualizar_detalle_linea: solo gestión y el operario cuya área coincide con el trabajo.
-- ------------------------------------------------------------------------------------------
create or replace function actualizar_detalle_linea(
  p_linea_id    uuid,
  p_detalle_taller text,
  p_servicio_id uuid
) returns void
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_area text;
begin
  select t.area into v_area
    from lineas l
    join trabajos t on t.id = l.trabajo_id
   where l.id = p_linea_id;

  if not found then
    raise exception 'La línea no existe.' using errcode = 'P0001';
  end if;

  -- gestión (es_gestion()) o el operario del área correcta
  if not (
    es_gestion()
    or (rol_actual() = 'operario_afilado'      and v_area = 'afilado')
    or (rol_actual() = 'operario_encuadernacion' and v_area = 'encuadernacion')
  ) then
    raise exception 'Sin permiso para actualizar el detalle de esta línea.' using errcode = 'P0001';
  end if;

  update lineas
     set detalle_taller = p_detalle_taller,
         servicio_id    = p_servicio_id
   where id = p_linea_id;
end;
$$;

revoke all on function actualizar_detalle_linea(uuid, text, uuid) from public;
grant execute on function actualizar_detalle_linea(uuid, text, uuid) to authenticated;
