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
