-- Pruebas de 0007_ruta.sql: entregar_unidades, límites del chofer, visitas y Storage de documentos.
-- Compatible con pgTAP y con el shim local (scripts/sql-local/pgtap_shim.sql).
--
-- Concurrencia (pruebas 1-4): dblink abre dos conexiones reales; A mantiene su entrega abierta y B
-- espera el bloqueo. Igual que mover_unidades.test.sql: si dblink no está o no conecta (Supabase),
-- se marcan SKIP. La carrera con muchas sesiones es scripts/sql-local/carrera_entregar_unidades.sh.
\set ON_ERROR_STOP 1
\pset tuples_only on
\pset format unaligned

begin;
select plan(97);

select id as recibido from etapas where area = 'afilado' and nombre = 'Recibido' \gset
select id as taller from etapas where area = 'afilado' and nombre = 'En taller' \gset
select id as listo from etapas where area = 'afilado' and nombre = 'Listo' \gset
select id as entregado from etapas where area = 'afilado' and nombre = 'Entregado' \gset
select id as enc_recibido from etapas where area = 'encuadernacion' and nombre = 'Recibido' \gset
select id as enc_terminado from etapas where area = 'encuadernacion' and nombre = 'Terminado' \gset
select coalesce(nullif(current_setting('pruebas.dblink_conn', true), ''),
                format('dbname=%s user=%s', current_database(), current_user)) as conn \gset

-- Cambia de usuario (rol authenticated + sub del JWT); null = sin sesión.
create function pg_temp.como(p uuid) returns void language plpgsql as $f$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', coalesce(json_build_object('sub', p)::text, ''), true);
end $f$;

-- ===================== Concurrencia con dblink (datos confirmados) =====================
create function pg_temp.dblink_disponible(p_conn text) returns boolean language plpgsql as $f$
begin
  begin
    create extension if not exists dblink;
    execute 'select dblink_connect(''prep7'', $1)' using p_conn;
    return true;
  exception when others then
    raise notice 'dblink no disponible (%): se omiten las pruebas de concurrencia', sqlerrm;
    return false;
  end;
end $f$;

create function pg_temp.limpiar_concurrencia() returns void language plpgsql as $f$
declare c text;
begin
  foreach c in array array['a7', 'b7'] loop
    if c = any(coalesce(dblink_get_connections(), '{}')) then perform dblink_disconnect(c); end if;
  end loop;
  if 'prep7' = any(coalesce(dblink_get_connections(), '{}')) then
    perform dblink_exec('prep7', $$
      delete from movimientos where linea_id = 'b0000000-0000-0000-0000-0000000007c1';
      delete from lineas where id = 'b0000000-0000-0000-0000-0000000007c1';
      delete from trabajos where cliente_id = 'c0000000-0000-0000-0000-0000000007c1';
      delete from clientes where id = 'c0000000-0000-0000-0000-0000000007c1';
      delete from perfiles where usuario_id in ('a0000000-0000-0000-0000-0000000007c1','a0000000-0000-0000-0000-0000000007c2');
      delete from auth.users where id in ('a0000000-0000-0000-0000-0000000007c1','a0000000-0000-0000-0000-0000000007c2');
    $$);
    perform dblink_disconnect('prep7');
  end if;
end $f$;

create function pg_temp.concurrencia(p_conn text) returns setof text language plpgsql as $f$
declare
  bpid integer;
  entregar4 text := $$select entregar_unidades('[{"linea_id":"b0000000-0000-0000-0000-0000000007c1","cantidad":4}]', 'G-%s')$$;
begin
  begin
    perform dblink_exec('prep7', $$
      delete from movimientos where linea_id = 'b0000000-0000-0000-0000-0000000007c1';
      delete from lineas where id = 'b0000000-0000-0000-0000-0000000007c1';
      delete from trabajos where cliente_id = 'c0000000-0000-0000-0000-0000000007c1';
      delete from clientes where id = 'c0000000-0000-0000-0000-0000000007c1';
      delete from perfiles where usuario_id in ('a0000000-0000-0000-0000-0000000007c1','a0000000-0000-0000-0000-0000000007c2');
      delete from auth.users where id in ('a0000000-0000-0000-0000-0000000007c1','a0000000-0000-0000-0000-0000000007c2');
      insert into auth.users (id) values ('a0000000-0000-0000-0000-0000000007c1'), ('a0000000-0000-0000-0000-0000000007c2');
      insert into perfiles values ('a0000000-0000-0000-0000-0000000007c1', 'Chofer A', 'chofer'),
                                  ('a0000000-0000-0000-0000-0000000007c2', 'Chofer B', 'chofer');
      insert into clientes (id, nombre, rut) values ('c0000000-0000-0000-0000-0000000007c1', 'Cliente concurrencia 7', '1-9');
      with t as (insert into trabajos (cliente_id, area, entrada, salida)
                 values ('c0000000-0000-0000-0000-0000000007c1', 'afilado', 'ruta_propia', 'ruta_propia') returning id)
      insert into lineas (id, trabajo_id, producto, cantidad) select 'b0000000-0000-0000-0000-0000000007c1', id, 'Cuchillo', 6 from t;
      insert into movimientos (linea_id, cantidad, etapa_origen_id, etapa_destino_id, usuario_id)
        select 'b0000000-0000-0000-0000-0000000007c1', 6, null, id, 'a0000000-0000-0000-0000-0000000007c1'
          from etapas where area = 'afilado' and nombre = 'Recibido';
      insert into movimientos (linea_id, cantidad, etapa_origen_id, etapa_destino_id, usuario_id)
        select 'b0000000-0000-0000-0000-0000000007c1', 6, r.id, l.id, 'a0000000-0000-0000-0000-0000000007c1'
          from etapas r, etapas l where r.area = 'afilado' and r.nombre = 'Recibido' and l.area = 'afilado' and l.nombre = 'Listo';
    $$);
    perform dblink_connect('a7', p_conn);
    perform dblink_connect('b7', p_conn);
    perform dblink_exec('a7', 'set role authenticated');
    perform dblink_exec('a7', $$set request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-0000000007c1"}'$$);
    perform dblink_exec('b7', 'set role authenticated');
    perform dblink_exec('b7', $$set request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-0000000007c2"}'$$);
    select pid into bpid from dblink('b7', 'select pg_backend_pid()') as t(pid int);

    perform dblink_exec('a7', 'begin');
    perform * from dblink('a7', format(entregar4, 'A')) as t(r text);
    return next ok(true, 'concurrencia: el chofer A entrega 4 de 6 listas dentro de su transacción abierta');

    perform dblink_send_query('b7', format(entregar4, 'B'));
    perform pg_sleep(0.5);
    perform pg_stat_clear_snapshot();
    return next ok(dblink_is_busy('b7') = 1
              and exists (select 1 from pg_stat_activity where pid = bpid and wait_event_type = 'Lock'),
      'concurrencia: el chofer B, que entrega las mismas unidades, espera el bloqueo de A');

    perform dblink_exec('a7', 'commit');
    perform count(*) from dblink_get_result('b7', false) as t(r text);
    return next ok(dblink_error_message('b7') like '%«Cuchillo» tiene 2 unidades listas; no se pueden entregar 4 (faltan 2).%',
      'concurrencia: al liberarse el bloqueo B ve las 2 que quedan y falla con mensaje claro');
    perform count(*) from dblink_get_result('b7', false) as t(r text);

    return next is((select row(e, l, g)::text from dblink('prep7', $$
        select (select coalesce(sum(cantidad), 0) from movimientos m join etapas e on e.id = m.etapa_destino_id
                 where m.linea_id = 'b0000000-0000-0000-0000-0000000007c1' and e.es_final)::int,
               (select coalesce(sum(case when e.es_listo and m.etapa_destino_id = e.id then m.cantidad
                                         when e.es_listo and m.etapa_origen_id = e.id then -m.cantidad else 0 end), 0)
                  from movimientos m, etapas e where m.linea_id = 'b0000000-0000-0000-0000-0000000007c1'
                   and e.id in (m.etapa_origen_id, m.etapa_destino_id))::int,
               (select guia_despacho from trabajos where cliente_id = 'c0000000-0000-0000-0000-0000000007c1')
      $$) as t(e int, l int, g text)), row(4, 2, 'G-A')::text,
      'concurrencia: 4 entregadas, 2 siguen listas y la guía tiene solo el documento de A');
  exception when others then
    perform pg_temp.limpiar_concurrencia();
    raise;
  end;
  perform pg_temp.limpiar_concurrencia();
end $f$;

select pg_temp.dblink_disponible(:'conn') as dblink_ok \gset
\if :dblink_ok
select * from pg_temp.concurrencia(:'conn');
\else
select skip('dblink no disponible o sin conexión; la concurrencia se prueba con scripts/sql-local/carrera_entregar_unidades.sh', 4);
\endif

-- ===================== Datos (se revierten al final) =====================
insert into auth.users (id) values
  ('a0000000-0000-0000-0000-000000000701'), ('a0000000-0000-0000-0000-000000000702'),
  ('a0000000-0000-0000-0000-000000000703'), ('a0000000-0000-0000-0000-000000000704'),
  ('a0000000-0000-0000-0000-000000000705');
insert into perfiles (usuario_id, nombre, rol) values
  ('a0000000-0000-0000-0000-000000000701', 'Secretaria', 'secretaria'),
  ('a0000000-0000-0000-0000-000000000702', 'Chofer', 'chofer'),
  ('a0000000-0000-0000-0000-000000000703', 'Chofer 2', 'chofer'),
  ('a0000000-0000-0000-0000-000000000704', 'Afilador', 'operario_afilado'),
  ('a0000000-0000-0000-0000-000000000705', 'Jefe', 'jefe_taller');
\set sec a0000000-0000-0000-0000-000000000701
\set chofer a0000000-0000-0000-0000-000000000702
\set chofer2 a0000000-0000-0000-0000-000000000703
\set operario a0000000-0000-0000-0000-000000000704
\set jefe a0000000-0000-0000-0000-000000000705
insert into clientes (id, nombre, rut) values
  ('c0000000-0000-0000-0000-000000000701', 'Cliente ruta', '1-9'),
  ('c0000000-0000-0000-0000-000000000702', 'Cliente extra', '2-7');
-- Una segunda etapa "listo" en afilado, para probar que se entrega desde todas, por orden.
insert into etapas (area, orden, nombre, es_listo, es_final) values ('afilado', 6, 'Bodega 2', true, false);
select id as bodega from etapas where area = 'afilado' and nombre = 'Bodega 2' \gset

insert into trabajos (id, cliente_id, area, entrada, salida, guia_despacho) values
  ('d0000000-0000-0000-0000-000000000701', 'c0000000-0000-0000-0000-000000000701', 'afilado', 'ruta_propia', 'ruta_propia', null),
  ('d0000000-0000-0000-0000-000000000702', 'c0000000-0000-0000-0000-000000000701', 'afilado', 'ruta_propia', 'ruta_propia', '100'),
  ('d0000000-0000-0000-0000-000000000703', 'c0000000-0000-0000-0000-000000000701', 'encuadernacion', 'cliente', 'cliente', null),
  ('d0000000-0000-0000-0000-000000000704', 'c0000000-0000-0000-0000-000000000701', 'afilado', 'ruta_propia', 'ruta_propia', null);
insert into lineas (id, trabajo_id, producto, cantidad) values
  ('b0000000-0000-0000-0000-000000000711', 'd0000000-0000-0000-0000-000000000701', 'Cuchillo', 4),
  ('b0000000-0000-0000-0000-000000000712', 'd0000000-0000-0000-0000-000000000701', 'Tijera', 5),
  ('b0000000-0000-0000-0000-000000000713', 'd0000000-0000-0000-0000-000000000702', 'Hacha', 2),
  ('b0000000-0000-0000-0000-000000000714', 'd0000000-0000-0000-0000-000000000703', 'Libro', 1),
  ('b0000000-0000-0000-0000-000000000715', 'd0000000-0000-0000-0000-000000000704', 'P5', 2),
  ('b0000000-0000-0000-0000-000000000716', 'd0000000-0000-0000-0000-000000000704', 'P6', 2),
  ('b0000000-0000-0000-0000-000000000717', 'd0000000-0000-0000-0000-000000000704', 'P7', 2);
insert into movimientos (linea_id, cantidad, etapa_origen_id, etapa_destino_id, usuario_id) values
  ('b0000000-0000-0000-0000-000000000711', 4, null, :'recibido', :'sec'),
  ('b0000000-0000-0000-0000-000000000711', 4, :'recibido', :'listo', :'sec'),
  ('b0000000-0000-0000-0000-000000000712', 5, null, :'recibido', :'sec'),
  ('b0000000-0000-0000-0000-000000000712', 2, :'recibido', :'listo', :'sec'),
  ('b0000000-0000-0000-0000-000000000712', 1, :'recibido', :'bodega', :'sec'),
  ('b0000000-0000-0000-0000-000000000713', 2, null, :'recibido', :'sec'),
  ('b0000000-0000-0000-0000-000000000713', 2, :'recibido', :'listo', :'sec'),
  ('b0000000-0000-0000-0000-000000000714', 1, null, :'enc_recibido', :'sec'),
  ('b0000000-0000-0000-0000-000000000714', 1, :'enc_recibido', :'enc_terminado', :'sec'),
  ('b0000000-0000-0000-0000-000000000715', 2, null, :'recibido', :'sec'),
  ('b0000000-0000-0000-0000-000000000715', 2, :'recibido', :'listo', :'sec'),
  ('b0000000-0000-0000-0000-000000000716', 2, null, :'recibido', :'sec'),
  ('b0000000-0000-0000-0000-000000000716', 2, :'recibido', :'listo', :'sec'),
  ('b0000000-0000-0000-0000-000000000717', 2, null, :'recibido', :'sec'),
  ('b0000000-0000-0000-0000-000000000717', 2, :'recibido', :'listo', :'sec');

-- ===================== entregar_unidades =====================
select pg_temp.como(:'chofer') \g /dev/null
select lives_ok($q$select entregar_unidades('[{"linea_id":"b0000000-0000-0000-0000-000000000711","cantidad":3}]', ' 4521 ')$q$,
  'el chofer entrega 3 de 4 listas con el documento 4521');
select is(unidades_en_etapa('b0000000-0000-0000-0000-000000000711', :'listo'), 1, 'queda 1 lista');
select is(unidades_en_etapa('b0000000-0000-0000-0000-000000000711', :'entregado'), 3, 'hay 3 en la etapa final (Entregado)');
select is((select count(*) from movimientos where linea_id = 'b0000000-0000-0000-0000-000000000711'
            and etapa_origen_id = :'listo' and etapa_destino_id = :'entregado' and usuario_id = :'chofer'), 1::bigint,
  'el movimiento va de Listo a Entregado a nombre del chofer');
select is((select guia_despacho from trabajos where id = 'd0000000-0000-0000-0000-000000000701'), '4521',
  'el número de documento queda en la guía de despacho (sin espacios)');

select lives_ok($q$select entregar_unidades('[{"linea_id":"b0000000-0000-0000-0000-000000000711","cantidad":1}]', '4521')$q$,
  'entregar la última con el mismo documento');
select is((select guia_despacho from trabajos where id = 'd0000000-0000-0000-0000-000000000701'), '4521',
  'el mismo número no se repite en la guía');

select lives_ok($q$select entregar_unidades('[{"linea_id":"b0000000-0000-0000-0000-000000000713","cantidad":2},
                                            {"linea_id":"b0000000-0000-0000-0000-000000000712","cantidad":3}]', 'F-77')$q$,
  'entrega de varias líneas de dos trabajos en una llamada');
select is(array[unidades_en_etapa('b0000000-0000-0000-0000-000000000712', :'recibido'),
                unidades_en_etapa('b0000000-0000-0000-0000-000000000712', :'listo'),
                unidades_en_etapa('b0000000-0000-0000-0000-000000000712', :'bodega'),
                unidades_en_etapa('b0000000-0000-0000-0000-000000000712', :'entregado')], array[2, 0, 0, 3],
  'toma de todas las etapas "listo" (2 de Listo y 1 de Bodega 2) y nunca de las que no están listas');
select is((select array_agg(guia_despacho order by id) from trabajos
            where id in ('d0000000-0000-0000-0000-000000000701', 'd0000000-0000-0000-0000-000000000702')),
  array['4521, F-77', '100, F-77'], 'el documento se agrega con ", " a las guías que ya tenían otro número');
select is(unidades_en_etapa('b0000000-0000-0000-0000-000000000713', :'entregado'), 2, 'la otra línea también quedó entregada');

select throws_ok($q$select entregar_unidades('[{"linea_id":"b0000000-0000-0000-0000-000000000712","cantidad":1}]', '9')$q$,
  'P0001', '«Tijera» tiene 0 unidades listas; no se pueden entregar 1 (faltan 1).',
  'no se entregan unidades que no están listas (las 2 en Recibido no cuentan)');

-- Todo o nada: falta en la 2.ª de 3 líneas (en orden de id).
select throws_ok($q$select entregar_unidades('[{"linea_id":"b0000000-0000-0000-0000-000000000717","cantidad":2},
    {"linea_id":"b0000000-0000-0000-0000-000000000716","cantidad":3},{"linea_id":"b0000000-0000-0000-0000-000000000715","cantidad":2}]', 'X-1')$q$,
  'P0001', '«P6» tiene 2 unidades listas; no se pueden entregar 3 (faltan 1).', 'falta en la segunda de tres líneas: error que dice cuánto falta');
select is((select count(*) from movimientos where linea_id in ('b0000000-0000-0000-0000-000000000715',
    'b0000000-0000-0000-0000-000000000716', 'b0000000-0000-0000-0000-000000000717')), 6::bigint,
  'nada cambió: ninguna línea tiene movimientos nuevos');

-- Todo o nada: un fallo inesperado al registrar el movimiento de la 2.ª línea deshace la 1.ª.
reset role;
create function pg_temp.falla_segunda() returns trigger language plpgsql as $f$
begin
  if new.linea_id = 'b0000000-0000-0000-0000-000000000716' and new.etapa_origen_id is not null then
    raise exception 'fallo simulado' using errcode = 'XX000';
  end if;
  return new;
end $f$;
create trigger falla_segunda before insert on movimientos for each row execute function pg_temp.falla_segunda();
select pg_temp.como(:'chofer') \g /dev/null
select throws_ok($q$select entregar_unidades('[{"linea_id":"b0000000-0000-0000-0000-000000000715","cantidad":2},
    {"linea_id":"b0000000-0000-0000-0000-000000000716","cantidad":2},{"linea_id":"b0000000-0000-0000-0000-000000000717","cantidad":2}]', 'X-2')$q$,
  'XX000', 'fallo simulado', 'un fallo en la segunda de tres líneas aborta la entrega');
select is(array[unidades_en_etapa('b0000000-0000-0000-0000-000000000715', :'listo'),
                unidades_en_etapa('b0000000-0000-0000-0000-000000000715', :'entregado')], array[2, 0],
  'atomicidad: la primera línea sigue lista (su movimiento se deshizo)');
select is((select guia_despacho from trabajos where id = 'd0000000-0000-0000-0000-000000000704'), null::text,
  'atomicidad: la guía de despacho no cambió');
reset role;
drop trigger falla_segunda on movimientos;

-- Validación estricta de la entrada.
select pg_temp.como(:'chofer') \g /dev/null
select throws_ok($q$select entregar_unidades(null, '1')$q$, 'P0001', 'Indica qué entregar.', 'entregas null');
select throws_ok($q$select entregar_unidades('{}', '1')$q$, 'P0001', 'Indica qué entregar.', 'entregas que no son lista');
select throws_ok($q$select entregar_unidades('[]', '1')$q$, 'P0001', 'Indica qué entregar.', 'lista vacía');
select throws_ok($q$select entregar_unidades('[{"cantidad":1}]', '1')$q$, 'P0001', 'Falta la línea a entregar.', 'sin línea');
select throws_ok($q$select entregar_unidades('[{"linea_id":"","cantidad":1}]', '1')$q$, 'P0001', 'Falta la línea a entregar.', 'línea vacía');
select throws_ok($q$select entregar_unidades('[5]', '1')$q$, 'P0001', 'Falta la línea a entregar.', 'elemento que no es objeto');
select throws_ok($q$select entregar_unidades('[{"linea_id":"b0000000-0000-0000-0000-000000000715","cantidad":0}]', '1')$q$,
  'P0001', 'La cantidad a entregar debe ser un número entero mayor que cero.', 'cantidad 0');
select throws_ok($q$select entregar_unidades('[{"linea_id":"b0000000-0000-0000-0000-000000000715","cantidad":-1}]', '1')$q$,
  'P0001', 'La cantidad a entregar debe ser un número entero mayor que cero.', 'cantidad negativa');
select throws_ok($q$select entregar_unidades('[{"linea_id":"b0000000-0000-0000-0000-000000000715","cantidad":1.5}]', '1')$q$,
  'P0001', 'La cantidad a entregar debe ser un número entero mayor que cero.', 'cantidad decimal');
select throws_ok($q$select entregar_unidades('[{"linea_id":"b0000000-0000-0000-0000-000000000715","cantidad":"1"}]', '1')$q$,
  'P0001', 'La cantidad a entregar debe ser un número entero mayor que cero.', 'cantidad como texto');
select throws_ok($q$select entregar_unidades('[{"linea_id":"b0000000-0000-0000-0000-000000000715","cantidad":99999999999}]', '1')$q$,
  'P0001', 'La cantidad a entregar debe ser un número entero mayor que cero.', 'cantidad fuera de rango');
select throws_ok($q$select entregar_unidades('[{"linea_id":"b0000000-0000-0000-0000-000000000715"}]', '1')$q$,
  'P0001', 'La cantidad a entregar debe ser un número entero mayor que cero.', 'sin cantidad');
select throws_ok($q$select entregar_unidades('[{"linea_id":"b0000000-0000-0000-0000-000000000715","cantidad":1},
    {"linea_id":"B0000000-0000-0000-0000-000000000715","cantidad":1}]', '1')$q$,
  'P0001', 'No repitas la misma línea en una entrega.', 'línea repetida (aunque cambie mayúsculas)');
select throws_ok($q$select entregar_unidades('[{"linea_id":"b0000000-0000-0000-0000-000000000715","cantidad":1}]', null)$q$,
  'P0001', 'Anota el número de guía o factura.', 'sin documento');
select throws_ok($q$select entregar_unidades('[{"linea_id":"b0000000-0000-0000-0000-000000000715","cantidad":1}]', '   ')$q$,
  'P0001', 'Anota el número de guía o factura.', 'documento en blanco');
select throws_ok(format($q$select entregar_unidades('[{"linea_id":"b0000000-0000-0000-0000-000000000715","cantidad":1}]', %L)$q$, repeat('9', 41)),
  'P0001', 'El número de documento puede tener hasta 40 caracteres.', 'documento de 41 caracteres');
select lives_ok(format($q$select entregar_unidades('[{"linea_id":"b0000000-0000-0000-0000-000000000715","cantidad":1}]', %L)$q$, repeat('9', 40)),
  'documento de 40 caracteres sí');
select throws_ok($q$select entregar_unidades('[{"linea_id":"b0000000-0000-0000-0000-000000000715","cantidad":1}]', '1, 2')$q$,
  'P0001', 'El número de documento no puede llevar comas.', 'documento con coma');
select throws_ok($q$select entregar_unidades('[{"linea_id":"no-es-uuid","cantidad":1}]', '1')$q$,
  'P0001', 'La línea no existe.', 'línea con id inválido');
select throws_ok($q$select entregar_unidades('[{"linea_id":"b0000000-0000-0000-0000-0000000007ff","cantidad":1}]', '1')$q$,
  'P0001', 'La línea no existe.', 'línea inexistente');

reset role;
update etapas set es_final = false where area = 'encuadernacion';
select pg_temp.como(:'chofer') \g /dev/null
select throws_ok($q$select entregar_unidades('[{"linea_id":"b0000000-0000-0000-0000-000000000714","cantidad":1}]', '1')$q$,
  'P0001', 'El área no tiene una etapa de entrega configurada.', 'área sin etapa final');
reset role;
update etapas set es_final = true where area = 'encuadernacion' and nombre = 'Entregado';

-- Permisos de entrega.
select pg_temp.como(:'sec') \g /dev/null
select lives_ok($q$select entregar_unidades('[{"linea_id":"b0000000-0000-0000-0000-000000000714","cantidad":1}]', 'M-1')$q$,
  'la secretaria registra una entrega (retiro en mostrador)');
select pg_temp.como(:'operario') \g /dev/null
select throws_ok($q$select entregar_unidades('[{"linea_id":"b0000000-0000-0000-0000-000000000716","cantidad":1}]', '1')$q$,
  '42501', 'No tienes permiso para registrar entregas.', 'un operario no registra entregas');
select throws_ok($q$select bloquear_para_entrega(array['b0000000-0000-0000-0000-000000000716'::uuid])$q$,
  '42501', 'No tienes permiso para registrar entregas.', 'un operario tampoco puede bloquear líneas');
select pg_temp.como(null) \g /dev/null
select throws_ok($q$select entregar_unidades('[{"linea_id":"b0000000-0000-0000-0000-000000000716","cantidad":1}]', '1')$q$,
  '42501', 'Debes iniciar sesión para registrar entregas.', 'sin sesión no se entrega');
reset role;

select is(array[agregar_documento(null, '1'), agregar_documento(' ', '1'), agregar_documento('100', '1'),
                agregar_documento('100, 1', '1'), agregar_documento('100,1', '1'), agregar_documento('11', '1')],
  array['1', '1', '100, 1', '100, 1', '100,1', '11, 1'], 'agregar_documento: igual que agregarDocumento del cliente');

-- ===================== Límites del chofer sobre trabajos y líneas =====================
select pg_temp.como(:'chofer') \g /dev/null
select throws_ok($q$update trabajos set urgente = true where id = 'd0000000-0000-0000-0000-000000000701'$q$,
  '42501', 'Solo puedes cambiar la salida, la guía de despacho y la foto del documento de un trabajo.',
  'el chofer no cambia la marca de urgente');
select throws_ok($q$update trabajos set notas = 'x' where id = 'd0000000-0000-0000-0000-000000000701'$q$,
  '42501', 'Solo puedes cambiar la salida, la guía de despacho y la foto del documento de un trabajo.',
  'el chofer no cambia las notas');
select throws_ok($q$update trabajos set cliente_id = 'c0000000-0000-0000-0000-000000000702' where id = 'd0000000-0000-0000-0000-000000000701'$q$,
  '42501', 'Solo puedes cambiar la salida, la guía de despacho y la foto del documento de un trabajo.',
  'el chofer no cambia el cliente');
select throws_ok($q$update trabajos set creado_por = 'a0000000-0000-0000-0000-000000000702' where id = 'd0000000-0000-0000-0000-000000000701'$q$,
  '42501', 'Solo puedes cambiar la salida, la guía de despacho y la foto del documento de un trabajo.',
  'el chofer no se adueña de un trabajo');
select lives_ok($q$update trabajos set salida = 'cliente', guia_despacho = 'G-9',
    foto_documento = 'd0000000-0000-0000-0000-000000000701/foto.jpg' where id = 'd0000000-0000-0000-0000-000000000701'$q$,
  'el chofer sí cambia salida, guía de despacho y foto del documento');
select is((select row(salida, guia_despacho, foto_documento)::text from trabajos where id = 'd0000000-0000-0000-0000-000000000701'),
  row('cliente'::modalidad, 'G-9', 'd0000000-0000-0000-0000-000000000701/foto.jpg')::text, 'los tres campos quedaron guardados');
select throws_ok($q$update trabajos set foto_documento = 'd0000000-0000-0000-0000-000000000702/foto.jpg' where id = 'd0000000-0000-0000-0000-000000000701'$q$,
  'P0001', 'La foto debe estar en la carpeta del trabajo.', 'la foto no puede apuntar a la carpeta de otro trabajo');
select pg_temp.como(:'sec') \g /dev/null
select throws_ok($q$update trabajos set foto_documento = 'foto.jpg' where id = 'd0000000-0000-0000-0000-000000000701'$q$,
  'P0001', 'La foto debe estar en la carpeta del trabajo.', 'tampoco para gestión');
select lives_ok($q$update trabajos set urgente = true, notas = 'revisar', salida = 'ruta_propia' where id = 'd0000000-0000-0000-0000-000000000701'$q$,
  'la secretaria sigue editando cualquier campo');
select pg_temp.como(:'jefe') \g /dev/null
select lives_ok($q$update trabajos set transporte = 'Starken 123' where id = 'd0000000-0000-0000-0000-000000000701'$q$,
  'el jefe de taller sigue editando cualquier campo');

select pg_temp.como(:'chofer') \g /dev/null
select throws_ok($q$insert into lineas (trabajo_id, producto, cantidad) values ('d0000000-0000-0000-0000-000000000701', 'Colada', 1)$q$,
  '42501', null, 'el chofer no agrega líneas a un trabajo existente con movimientos');
select throws_ok($q$insert into trabajos (cliente_id, area, entrada, salida, creado_por)
    values ('c0000000-0000-0000-0000-000000000701', 'afilado', 'ruta_propia', 'ruta_propia', 'a0000000-0000-0000-0000-000000000701')$q$,
  '42501', null, 'el chofer no crea un trabajo a nombre de otro');
select lives_ok($q$insert into trabajos (id, cliente_id, area, entrada, salida)
    values ('d0000000-0000-0000-0000-000000000705', 'c0000000-0000-0000-0000-000000000701', 'afilado', 'ruta_propia', 'ruta_propia')$q$,
  'el chofer crea un trabajo propio (queda a su nombre)');
select is((select creado_por from trabajos where id = 'd0000000-0000-0000-0000-000000000705'), :'chofer'::uuid,
  'creado_por es el usuario de la sesión');
select lives_ok($q$insert into lineas (id, trabajo_id, producto, cantidad)
    values ('b0000000-0000-0000-0000-000000000751', 'd0000000-0000-0000-0000-000000000705', 'Retiro', 2)$q$,
  'el chofer agrega líneas a su trabajo de hoy sin movimientos');
select pg_temp.como(:'chofer2') \g /dev/null
select throws_ok($q$insert into lineas (trabajo_id, producto, cantidad) values ('d0000000-0000-0000-0000-000000000705', 'Colada', 1)$q$,
  '42501', null, 'otro chofer no agrega líneas a ese trabajo');
select pg_temp.como(:'chofer') \g /dev/null
select lives_ok(format($q$insert into movimientos (linea_id, cantidad, etapa_origen_id, etapa_destino_id, usuario_id)
    values ('b0000000-0000-0000-0000-000000000751', 2, null, %L, %L)$q$, :'recibido', :'chofer'),
  'el chofer registra la recepción de su retiro');
select throws_ok($q$insert into lineas (trabajo_id, producto, cantidad) values ('d0000000-0000-0000-0000-000000000705', 'Colada', 1)$q$,
  '42501', null, 'con movimientos, ni el chofer que lo creó agrega líneas');
reset role;
insert into trabajos (id, cliente_id, area, entrada, salida, creado_por, recibido_en)
  values ('d0000000-0000-0000-0000-000000000706', 'c0000000-0000-0000-0000-000000000701', 'afilado', 'ruta_propia', 'ruta_propia',
          :'chofer', now() - interval '2 days');
select pg_temp.como(:'chofer') \g /dev/null
select throws_ok($q$insert into lineas (trabajo_id, producto, cantidad) values ('d0000000-0000-0000-0000-000000000706', 'Colada', 1)$q$,
  '42501', null, 'el chofer no agrega líneas a un trabajo suyo de otro día');

create temp table retiro as select * from crear_trabajo('{"cliente_id":"c0000000-0000-0000-0000-000000000701","area":"afilado",
  "entrada":"ruta_propia","lineas":[{"producto":"A","cantidad":1},{"producto":"B","cantidad":2},{"producto":"C","cantidad":3}]}'::jsonb);
select is((select row(r.creado_por, (select count(*) from lineas where trabajo_id = r.id),
                      (select count(*) from movimientos m join lineas l on l.id = m.linea_id
                        where l.trabajo_id = r.id and m.etapa_origen_id is null and m.cantidad = l.cantidad))::text from retiro r),
  row(:'chofer'::uuid, 3::bigint, 3::bigint)::text, 'crear_trabajo sigue funcionando para el chofer (3 líneas y sus recepciones)');
select throws_ok(format($q$insert into lineas (trabajo_id, producto, cantidad) values (%L, 'D', 1)$q$, (select id from retiro)),
  '42501', null, 'después de crear_trabajo el chofer ya no le agrega líneas');

select throws_ok(format('select mover_unidades(%L, 1, %L, %L)', 'b0000000-0000-0000-0000-000000000712', :'recibido', :'taller'),
  '42501', null, 'el chofer no mueve unidades dentro del taller');
select lives_ok(format('select mover_unidades(%L, 1, %L, %L)', 'b0000000-0000-0000-0000-000000000717', :'listo', :'entregado'),
  'el chofer sí mueve de una etapa "listo" a la final');
select pg_temp.como(:'sec') \g /dev/null
select lives_ok($q$insert into lineas (trabajo_id, producto, cantidad) values ('d0000000-0000-0000-0000-000000000701', 'Colada', 1)$q$,
  'la secretaria sigue agregando líneas a trabajos existentes');
select lives_ok(format('select mover_unidades(%L, 1, %L, %L)', 'b0000000-0000-0000-0000-000000000712', :'recibido', :'taller'),
  'la secretaria sigue moviendo unidades en el taller');
reset role;

-- ===================== Visitas =====================
select d as futuro from generate_series(hoy_chile() + 1, hoy_chile() + 7, interval '1 day') d
  where extract(isodow from d) <= 5 order by d limit 1 \gset
select d as pasado from generate_series(hoy_chile() - 7, hoy_chile() - 1, interval '1 day') d
  where extract(isodow from d) <= 5 order by d desc limit 1 \gset
select d as sabado from generate_series(hoy_chile() + 1, hoy_chile() + 7, interval '1 day') d
  where extract(isodow from d) = 6 limit 1 \gset

select pg_temp.como(:'sec') \g /dev/null
select lives_ok(format($q$insert into visitas (fecha, cliente_id, solicitada, nota) values (%L, 'c0000000-0000-0000-0000-000000000701', true, 'Llamó')$q$, :'futuro'),
  'la secretaria agrega una visita extra (sin recorrido)');
select throws_ok(format($q$insert into visitas (fecha, cliente_id) values (%L, 'c0000000-0000-0000-0000-000000000701')$q$, :'futuro'),
  '23505', null, 'una sola visita por cliente y día');
select lives_ok(format($q$insert into visitas (fecha, cliente_id, confirmada) values (%L, 'c0000000-0000-0000-0000-000000000701', 'no')
    on conflict (fecha, cliente_id) do update set confirmada = excluded.confirmada$q$, :'futuro'),
  'marcar la confirmación es un upsert sobre (fecha, cliente)');
select is((select row(count(*), min(confirmada), bool_and(solicitada), min(nota))::text from visitas
            where fecha = :'futuro' and cliente_id = 'c0000000-0000-0000-0000-000000000701'),
  row(1::bigint, 'no', true, 'Llamó')::text, 'el upsert solo cambió la confirmación');
select throws_ok(format($q$insert into visitas (fecha, cliente_id) values (%L, 'c0000000-0000-0000-0000-000000000702')$q$, :'sabado'),
  '23514', null, 'no hay visitas en fin de semana');
select throws_ok(format($q$insert into visitas (fecha, cliente_id, nota) values (%L, 'c0000000-0000-0000-0000-000000000702', %L)$q$,
    :'futuro', repeat('x', 201)), '23514', null, 'nota de más de 200 caracteres');

select pg_temp.como(:'chofer') \g /dev/null
select lives_ok(format($q$insert into visitas (fecha, cliente_id, confirmada) values (%L, 'c0000000-0000-0000-0000-000000000701', 'si')
    on conflict (fecha, cliente_id) do update set confirmada = excluded.confirmada$q$, :'futuro'),
  'el chofer marca la confirmación de una visita de su ruta');
select is((select confirmada from visitas where fecha = :'futuro' and cliente_id = 'c0000000-0000-0000-0000-000000000701'), 'si',
  'quedó confirmada');
select lives_ok(format($q$insert into visitas (fecha, cliente_id, solicitada) values (%L, 'c0000000-0000-0000-0000-000000000702', true)$q$, :'futuro'),
  'el chofer agrega una parada extra');
reset role;
insert into visitas (fecha, cliente_id, confirmada) values (:'pasado', 'c0000000-0000-0000-0000-000000000701', 'sin_respuesta');
select pg_temp.como(:'chofer') \g /dev/null
with u as (update visitas set confirmada = 'si' where fecha = :'pasado' returning 1)
select is((select count(*) from u), 0::bigint, 'el chofer no reescribe visitas de días pasados');
select throws_ok(format($q$insert into visitas (fecha, cliente_id) values (%L, 'c0000000-0000-0000-0000-000000000702')$q$, :'pasado'),
  '42501', null, 'ni agrega visitas en días pasados');
select pg_temp.como(:'operario') \g /dev/null
select is((select count(*) from visitas), 0::bigint, 'un operario no ve visitas');
select throws_ok(format($q$insert into visitas (fecha, cliente_id) values (%L, 'c0000000-0000-0000-0000-000000000702')$q$, :'futuro'),
  '42501', null, 'ni las crea');
select pg_temp.como(:'jefe') \g /dev/null
with u as (delete from visitas where cliente_id = 'c0000000-0000-0000-0000-000000000702' returning 1)
select is((select count(*) from u), 1::bigint, 'el jefe de taller gestiona visitas (borra la parada extra)');
with u as (update visitas set confirmada = 'no' where fecha = :'pasado' returning 1)
select is((select count(*) from u), 1::bigint, 'gestión sí corrige visitas pasadas');
reset role;

-- ===================== Storage: bucket documentos =====================
select is((select row(public, file_size_limit, allowed_mime_types)::text from storage.buckets where id = 'documentos'),
  row(false, 8388608::bigint, array['image/jpeg', 'image/png', 'image/webp', 'image/heic'])::text,
  'bucket documentos privado, hasta 8 MB, solo JPG, PNG, WebP y HEIC (sin SVG)');
insert into storage.buckets (id, name) values ('otro', 'otro');
select pg_temp.como(:'chofer') \g /dev/null
select lives_ok($q$insert into storage.objects (bucket_id, name) values ('documentos', 'd0000000-0000-0000-0000-000000000701/a.jpg')$q$,
  'el chofer sube la foto a la carpeta del trabajo');
select throws_ok($q$insert into storage.objects (bucket_id, name) values ('documentos', 'd0000000-0000-0000-0000-0000000007ff/a.jpg')$q$,
  '42501', null, 'no en la carpeta de un trabajo que no existe');
select throws_ok($q$insert into storage.objects (bucket_id, name) values ('documentos', 'cualquier/a.jpg')$q$,
  '42501', null, 'no en una carpeta que no es un trabajo');
select throws_ok($q$insert into storage.objects (bucket_id, name) values ('documentos', 'a.jpg')$q$,
  '42501', null, 'no fuera de una carpeta');
select throws_ok($q$insert into storage.objects (bucket_id, name) values ('documentos', 'd0000000-0000-0000-0000-000000000701/x/a.jpg')$q$,
  '42501', null, 'no en subcarpetas');
select throws_ok($q$insert into storage.objects (bucket_id, name) values ('otro', 'd0000000-0000-0000-0000-000000000701/a.jpg')$q$,
  '42501', null, 'las políticas no abren otros buckets');
select pg_temp.como(:'operario') \g /dev/null
select throws_ok($q$insert into storage.objects (bucket_id, name) values ('documentos', 'd0000000-0000-0000-0000-000000000701/b.jpg')$q$,
  '42501', null, 'un operario no sube fotos de documentos');
select is((select count(*) from storage.objects where bucket_id = 'documentos'), 0::bigint, 'ni las ve');
select pg_temp.como(:'sec') \g /dev/null
select is((select count(*) from storage.objects where bucket_id = 'documentos'), 1::bigint, 'la secretaria ve la foto');
reset role;

select * from finish();
rollback;
