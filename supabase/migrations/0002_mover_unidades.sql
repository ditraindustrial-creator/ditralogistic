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
