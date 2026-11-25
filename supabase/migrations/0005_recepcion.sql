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
