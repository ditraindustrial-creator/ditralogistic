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
