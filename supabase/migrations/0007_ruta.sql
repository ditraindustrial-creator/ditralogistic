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
