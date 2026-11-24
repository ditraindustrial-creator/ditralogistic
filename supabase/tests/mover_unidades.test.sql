-- Pruebas de mover_unidades y del trigger movimientos_validar (migración 0002).
-- Compatible con pgTAP (`supabase test db`, que lo corre con psql vía pg_prove) y con el
-- shim de scripts/sql-local/pgtap_shim.sql (ver scripts/sql-local/correr_pruebas.sh).
--
-- Concurrencia (pruebas 1-6): usa dblink para abrir dos conexiones reales; A mantiene el
-- bloqueo de la línea y B espera. Cadena de conexión: setting `pruebas.dblink_conn`
-- (p. ej. `set pruebas.dblink_conn = 'host=... user=... password=...'` o
-- PGOPTIONS='-c pruebas.dblink_conn=...'); por defecto, la base actual sin contraseña.
-- Si dblink no está disponible o no puede conectarse (p. ej. en Supabase, donde postgres no
-- es superusuario y dblink exige contraseña), esas 6 pruebas se marcan SKIP y el resto corre.
-- La prueba de concurrencia que siempre corre localmente es scripts/sql-local/carrera_mover_unidades.sh.
--
-- Los datos de concurrencia se confirman (otras conexiones deben verlos). Se borran antes de
-- empezar, al terminar y también si algo falla a mitad (manejador de excepción).
\set ON_ERROR_STOP 1
\pset tuples_only on
\pset format unaligned

begin;
select plan(26);

select id as recibido from etapas where area = 'afilado' and nombre = 'Recibido' \gset
select id as taller from etapas where area = 'afilado' and nombre = 'En taller' \gset
select id as listo from etapas where area = 'afilado' and nombre = 'Listo' \gset
select id as afilado_et from etapas where area = 'afilado' and nombre = 'Afilado' \gset
select id as enc_prod from etapas where area = 'encuadernacion' and nombre = 'En producción' \gset
select coalesce(nullif(current_setting('pruebas.dblink_conn', true), ''),
                format('dbname=%s user=%s', current_database(), current_user)) as conn \gset

-- ===================== Concurrencia (datos confirmados, visibles para otras conexiones) =====================
-- Abre la conexión 'prep' si se puede; nunca lanza error.
create function pg_temp.dblink_disponible(p_conn text) returns boolean language plpgsql as $f$
begin
  begin
    create extension if not exists dblink;
    execute 'select dblink_connect(''prep'', $1)' using p_conn;
    return true;
  exception when others then
    raise notice 'dblink no disponible (%): se omiten las pruebas de concurrencia', sqlerrm;
    return false;
  end;
end $f$;

-- Cierra A y B (revierte sus transacciones abiertas), borra los datos de concurrencia y cierra 'prep'.
create function pg_temp.cerrar_y_limpiar() returns void language plpgsql as $f$
declare c text;
begin
  foreach c in array array['a', 'b'] loop
    if c = any(coalesce(dblink_get_connections(), '{}')) then perform dblink_disconnect(c); end if;
  end loop;
  if 'prep' = any(coalesce(dblink_get_connections(), '{}')) then
    perform dblink_exec('prep', $$
      delete from movimientos where linea_id = 'b0000000-0000-0000-0000-0000000000c1';
      delete from lineas where id = 'b0000000-0000-0000-0000-0000000000c1';
      delete from trabajos where cliente_id = 'c0000000-0000-0000-0000-0000000000c1';
      delete from clientes where id = 'c0000000-0000-0000-0000-0000000000c1';
      delete from perfiles where usuario_id in ('a0000000-0000-0000-0000-0000000000c1','a0000000-0000-0000-0000-0000000000c2');
      delete from auth.users where id in ('a0000000-0000-0000-0000-0000000000c1','a0000000-0000-0000-0000-0000000000c2');
    $$);
    perform dblink_disconnect('prep');
  end if;
end $f$;

create function pg_temp.concurrencia(p_conn text, p_taller uuid, p_listo uuid) returns setof text
  language plpgsql as $f$
declare
  l constant uuid := 'b0000000-0000-0000-0000-0000000000c1';
  bpid integer;
  mover4 text := format('select cantidad from mover_unidades(%L, 4, %L, %L)', l, p_taller, p_listo);
begin
  begin
    -- Limpieza previa por si una ejecución anterior se cortó, y datos de prueba.
    perform dblink_exec('prep', $$
      delete from movimientos where linea_id = 'b0000000-0000-0000-0000-0000000000c1';
      delete from lineas where id = 'b0000000-0000-0000-0000-0000000000c1';
      delete from trabajos where cliente_id = 'c0000000-0000-0000-0000-0000000000c1';
      delete from clientes where id = 'c0000000-0000-0000-0000-0000000000c1';
      delete from perfiles where usuario_id in ('a0000000-0000-0000-0000-0000000000c1','a0000000-0000-0000-0000-0000000000c2');
      delete from auth.users where id in ('a0000000-0000-0000-0000-0000000000c1','a0000000-0000-0000-0000-0000000000c2');
      insert into auth.users (id) values ('a0000000-0000-0000-0000-0000000000c1'), ('a0000000-0000-0000-0000-0000000000c2');
      insert into perfiles values ('a0000000-0000-0000-0000-0000000000c1', 'Operario A', 'operario_afilado'),
                                  ('a0000000-0000-0000-0000-0000000000c2', 'Operario B', 'operario_afilado');
      insert into clientes (id, nombre, rut) values ('c0000000-0000-0000-0000-0000000000c1', 'Cliente concurrencia', '1-9');
      with t as (insert into trabajos (cliente_id, area, entrada, salida)
                 values ('c0000000-0000-0000-0000-0000000000c1', 'afilado', 'cliente', 'cliente') returning id)
      insert into lineas (id, trabajo_id, producto, cantidad)
        select 'b0000000-0000-0000-0000-0000000000c1', id, 'Cuchillo', 6 from t;
      insert into movimientos (linea_id, cantidad, etapa_origen_id, etapa_destino_id, usuario_id)
        select 'b0000000-0000-0000-0000-0000000000c1', 6, null, id, 'a0000000-0000-0000-0000-0000000000c1'
          from etapas where area = 'afilado' and nombre = 'Recibido';
      insert into movimientos (linea_id, cantidad, etapa_origen_id, etapa_destino_id, usuario_id)
        select 'b0000000-0000-0000-0000-0000000000c1', 6, r.id, t.id, 'a0000000-0000-0000-0000-0000000000c1'
          from etapas r, etapas t where r.area = 'afilado' and r.nombre = 'Recibido'
           and t.area = 'afilado' and t.nombre = 'En taller';
    $$);

    perform dblink_connect('a', p_conn);
    perform dblink_connect('b', p_conn);
    perform dblink_exec('a', 'set role authenticated');
    perform dblink_exec('a', $$set request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-0000000000c1"}'$$);
    perform dblink_exec('b', 'set role authenticated');
    perform dblink_exec('b', $$set request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-0000000000c2"}'$$);
    select pid into bpid from dblink('b', 'select pg_backend_pid()') as t(pid int);

    -- A abre transacción, mueve 4 de 6 y NO confirma: mantiene el bloqueo de la línea.
    perform dblink_exec('a', 'begin');
    return next is((select c from dblink('a', mover4) as t(c int)), 4,
      'concurrencia: A mueve 4 de 6 dentro de su transacción abierta');

    -- B, en otra conexión y al mismo tiempo, intenta mover 4: debe quedar esperando el bloqueo.
    perform dblink_send_query('b', mover4);
    perform pg_sleep(0.5);
    perform pg_stat_clear_snapshot();
    return next ok(dblink_is_busy('b') = 1
              and exists (select 1 from pg_stat_activity where pid = bpid and wait_event_type = 'Lock'),
      'concurrencia: B queda esperando el bloqueo de la línea que tiene A');

    perform dblink_exec('a', 'commit');
    return next is((select count(*) from dblink_get_result('b', false) as t(c int)), 0::bigint,
      'concurrencia: B no obtiene movimiento');
    return next ok(dblink_error_message('b') like '%Solo hay 2 unidades en esta etapa; no se pueden mover 4.%',
      'concurrencia: al liberarse el bloqueo B ve las 2 restantes y falla con mensaje claro');
    perform count(*) from dblink_get_result('b', false) as t(c int);

    -- B ahora mueve las 2 que quedan mientras A vuelve a tomar el bloqueo e intenta mover 1.
    perform dblink_exec('b', 'begin');
    perform count(*) from dblink('b', format('select cantidad from mover_unidades(%L, 2, %L, %L)',
      l, p_taller, p_listo)) as t(c int);
    perform dblink_send_query('a', format('select cantidad from mover_unidades(%L, 1, %L, %L)',
      l, p_taller, p_listo));
    perform pg_sleep(0.3);
    perform dblink_exec('b', 'commit');
    return next is((select count(*) from dblink_get_result('a', false) as t(c int)), 0::bigint,
      'concurrencia: A no puede mover la unidad que B ya se llevó');
    perform count(*) from dblink_get_result('a', false) as t(c int);

    return next is((select array_agg(n order by n) from dblink('prep', format(
      $q$select coalesce(sum(case when etapa_destino_id = e.id then cantidad else 0 end), 0)
              - coalesce(sum(case when etapa_origen_id = e.id then cantidad else 0 end), 0)
           from etapas e left join movimientos m on m.linea_id = %L and e.id in (m.etapa_origen_id, m.etapa_destino_id)
          where e.area = 'afilado' group by e.id$q$, l)) as t(n int)),
      array[0, 0, 0, 0, 6],
      'concurrencia: ninguna etapa negativa y el total sigue siendo 6 (6 en Listo)');
  exception when others then
    perform pg_temp.cerrar_y_limpiar();
    raise;
  end;
  perform pg_temp.cerrar_y_limpiar();
end $f$;

select pg_temp.dblink_disponible(:'conn') as dblink_ok \gset
\if :dblink_ok
select * from pg_temp.concurrencia(:'conn', :'taller', :'listo');
\else
select skip('dblink no disponible o sin conexión; la concurrencia se prueba con scripts/sql-local/carrera_mover_unidades.sh', 6);
\endif

-- ===================== Reglas (dentro de esta transacción, se revierte al final) =====================
insert into auth.users (id) values
  ('a0000000-0000-0000-0000-000000000001'), ('a0000000-0000-0000-0000-000000000002'),
  ('a0000000-0000-0000-0000-000000000003');
insert into perfiles values
  ('a0000000-0000-0000-0000-000000000001', 'Op afilado', 'operario_afilado'),
  ('a0000000-0000-0000-0000-000000000002', 'Op afilado 2', 'operario_afilado'),
  ('a0000000-0000-0000-0000-000000000003', 'Op encuadernación', 'operario_encuadernacion');
insert into clientes (id, nombre, rut) values ('c0000000-0000-0000-0000-000000000001', 'Cliente', '1-9');
insert into trabajos (id, cliente_id, area, entrada, salida) values
  ('d0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'afilado', 'cliente', 'cliente');
insert into lineas (id, trabajo_id, producto, cantidad) values
  ('b0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'Cuchillo', 6);
-- Recepción inicial (la hará crearTrabajo en la tarea 4): 6 unidades en "En taller".
-- Recepción (solo a la primera etapa) y paso a En taller.
insert into movimientos (linea_id, cantidad, etapa_origen_id, etapa_destino_id, usuario_id)
  values ('b0000000-0000-0000-0000-000000000001', 6, null, :'recibido', 'a0000000-0000-0000-0000-000000000001'),
         ('b0000000-0000-0000-0000-000000000001', 6, :'recibido', :'taller', 'a0000000-0000-0000-0000-000000000001');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001"}', true) \g /dev/null

select is((select row(cantidad, etapa_origen_id, etapa_destino_id, usuario_id)::text
             from mover_unidades('b0000000-0000-0000-0000-000000000001', 4, :'taller', :'listo')),
  row(4, :'taller'::uuid, :'listo'::uuid, 'a0000000-0000-0000-0000-000000000001'::uuid)::text,
  'mueve 4 de 6 a Listo y registra al usuario de la sesión');
select is(unidades_en_etapa('b0000000-0000-0000-0000-000000000001', :'taller'), 2,
  'quedan 2 en En taller');
select is(unidades_en_etapa('b0000000-0000-0000-0000-000000000001', :'listo'), 4,
  'hay 4 en Listo');

select throws_ok(format('select mover_unidades(%L, 3, %L, %L)', 'b0000000-0000-0000-0000-000000000001', :'taller', :'listo'),
  'P0001', 'Solo hay 2 unidades en esta etapa; no se pueden mover 3.', 'mover 3 de las 2 restantes falla');
select throws_ok(format('select mover_unidades(%L, 0, %L, %L)', 'b0000000-0000-0000-0000-000000000001', :'taller', :'listo'),
  'P0001', 'La cantidad debe ser un número entero mayor que cero.', 'cantidad 0 falla');
select throws_ok(format('select mover_unidades(%L, -1, %L, %L)', 'b0000000-0000-0000-0000-000000000001', :'taller', :'listo'),
  'P0001', 'La cantidad debe ser un número entero mayor que cero.', 'cantidad negativa falla');
select throws_ok(format($q$select mover_unidades(%L, '1.5', %L, %L)$q$, 'b0000000-0000-0000-0000-000000000001', :'taller', :'listo'),
  '22P02', null, 'cantidad decimal como texto (como la envía la API) falla');
select throws_ok(format('select mover_unidades(%L, 1.5, %L, %L)', 'b0000000-0000-0000-0000-000000000001', :'taller', :'listo'),
  '42883', null, 'cantidad decimal numérica no se redondea: no hay función que la acepte');
select throws_ok(format('select mover_unidades(%L, 1, %L, %L)', 'b0000000-0000-0000-0000-000000000001', :'taller', :'taller'),
  'P0001', 'La etapa de origen y la de destino deben ser distintas.', 'origen igual a destino falla');
select throws_ok(format('select mover_unidades(%L, 1, %L, %L)', 'b0000000-0000-0000-0000-000000000001', :'taller', :'enc_prod'),
  'P0001', 'Las etapas no corresponden al área del trabajo.', 'destino de otra área falla');
select throws_ok(format('select mover_unidades(%L, 1, %L, %L)', 'b0000000-0000-0000-0000-000000000001', :'enc_prod', :'listo'),
  'P0001', 'Las etapas no corresponden al área del trabajo.', 'origen de otra área falla');
select throws_ok(format($q$insert into movimientos (linea_id, cantidad, etapa_origen_id, etapa_destino_id, usuario_id)
                          values (%L, 5, %L, %L, %L)$q$,
  'b0000000-0000-0000-0000-000000000001', :'taller', :'afilado_et', 'a0000000-0000-0000-0000-000000000001'),
  'P0001', 'Solo hay 2 unidades en esta etapa; no se pueden mover 5.', 'insert directo tampoco puede sacar más de lo que hay');
select throws_ok(format($q$insert into movimientos (linea_id, cantidad, etapa_origen_id, etapa_destino_id, usuario_id)
                          values (%L, 1, null, %L, %L)$q$,
  'b0000000-0000-0000-0000-000000000001', :'recibido', 'a0000000-0000-0000-0000-000000000001'),
  'P0001', 'La línea tiene 6 unidades y ya se recibieron 6; no se pueden recibir 1 más.', 'no se recibe más que el total de la línea');
select throws_ok(format($q$insert into movimientos (linea_id, cantidad, etapa_origen_id, etapa_destino_id, usuario_id)
                          values (%L, 1, %L, %L, %L)$q$,
  'b0000000-0000-0000-0000-000000000001', :'taller', :'listo', 'a0000000-0000-0000-0000-000000000002'),
  '42501', null, 'no se puede registrar un movimiento a nombre de otro usuario');

-- Operario de encuadernación no mueve líneas de afilado.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003"}', true) \g /dev/null
select throws_ok(format('select mover_unidades(%L, 1, %L, %L)', 'b0000000-0000-0000-0000-000000000001', :'taller', :'listo'),
  '42501', 'No tienes permiso para mover unidades de esta área.', 'operario de otra área no puede mover');

-- Sin sesión.
select set_config('request.jwt.claims', '', true) \g /dev/null
select throws_ok(format('select mover_unidades(%L, 1, %L, %L)', 'b0000000-0000-0000-0000-000000000001', :'taller', :'listo'),
  '42501', 'Debes iniciar sesión para mover unidades.', 'sin sesión no se mueve nada');

reset role;
select is((select count(*) from movimientos where linea_id = 'b0000000-0000-0000-0000-000000000001'), 3::bigint,
  'los intentos fallidos no dejaron movimientos');
select is(unidades_en_etapa('b0000000-0000-0000-0000-000000000001', :'taller'), 2,
  'tras los fallos siguen 2 en En taller');
select throws_ok($q$delete from lineas where id = 'b0000000-0000-0000-0000-000000000001'$q$,
  '23503', null, 'no se puede borrar una línea con movimientos (historial protegido)');
select throws_ok($q$delete from trabajos where id = 'd0000000-0000-0000-0000-000000000001'$q$,
  '23503', null, 'borrar el trabajo tampoco borra el historial en cascada');

select * from finish();
rollback;
