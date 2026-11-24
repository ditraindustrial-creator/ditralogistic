-- Pruebas de mover_unidades y del trigger movimientos_validar (migración 0002).
-- Compatible con pgTAP (`supabase test db`, que lo corre con psql vía pg_prove) y con el
-- shim de scripts/sql-local/pgtap_shim.sql (ver scripts/sql-local/correr_pruebas.sh).
-- La parte de concurrencia usa dblink: dos conexiones reales, A mantiene el bloqueo y B espera.
-- Cadena de conexión para dblink: setting pruebas.dblink_conn, o la base actual por defecto.
\set ON_ERROR_STOP 1
\pset tuples_only on
\pset format unaligned

begin;
create extension if not exists dblink \g /dev/null
select plan(26);

select id as taller from etapas where area = 'afilado' and nombre = 'En taller' \gset
select id as listo from etapas where area = 'afilado' and nombre = 'Listo' \gset
select id as afilado_et from etapas where area = 'afilado' and nombre = 'Afilado' \gset
select id as enc_prod from etapas where area = 'encuadernacion' and nombre = 'En producción' \gset
select coalesce(nullif(current_setting('pruebas.dblink_conn', true), ''),
                format('dbname=%s user=%s', current_database(), current_user)) as conn \gset

-- ===================== Concurrencia (datos confirmados, visibles para otras conexiones) =====================
select dblink_connect('prep', :'conn') \g /dev/null
select dblink_exec('prep', $$
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
      from etapas where area = 'afilado' and nombre = 'En taller';
$$) \g /dev/null

select dblink_connect('a', :'conn') \g /dev/null
select dblink_connect('b', :'conn') \g /dev/null
select dblink_exec('a', 'set role authenticated') \g /dev/null
select dblink_exec('a', $$set request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-0000000000c1"}'$$) \g /dev/null
select dblink_exec('b', 'set role authenticated') \g /dev/null
select dblink_exec('b', $$set request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-0000000000c2"}'$$) \g /dev/null
select pid as bpid from dblink('b', 'select pg_backend_pid()') as t(pid int) \gset

-- A abre transacción, mueve 4 de 6 y NO confirma: mantiene el bloqueo de la línea.
select dblink_exec('a', 'begin') \g /dev/null
select is((select c from dblink('a', format(
  'select cantidad from mover_unidades(%L, 4, %L, %L)',
  'b0000000-0000-0000-0000-0000000000c1', :'taller', :'listo')) as t(c int)), 4,
  'concurrencia: A mueve 4 de 6 dentro de su transacción abierta');

-- B, en otra conexión y al mismo tiempo, intenta mover 4: debe quedar esperando el bloqueo.
select dblink_send_query('b', format(
  'select cantidad from mover_unidades(%L, 4, %L, %L)',
  'b0000000-0000-0000-0000-0000000000c1', :'taller', :'listo')) \g /dev/null
select pg_sleep(0.5) \g /dev/null
select pg_stat_clear_snapshot() \g /dev/null
select ok(dblink_is_busy('b') = 1
          and exists (select 1 from pg_stat_activity where pid = :bpid and wait_event_type = 'Lock'),
  'concurrencia: B queda esperando el bloqueo de la línea que tiene A');

select dblink_exec('a', 'commit') \g /dev/null
select is((select count(*) from dblink_get_result('b', false) as t(c int)), 0::bigint,
  'concurrencia: B no obtiene movimiento');
select ok(dblink_error_message('b') like '%Solo hay 2 unidades en esta etapa; no se pueden mover 4.%',
  'concurrencia: al liberarse el bloqueo B ve las 2 restantes y falla con mensaje claro');
select count(*) from dblink_get_result('b', false) as t(c int) \g /dev/null

-- B ahora mueve las 2 que quedan mientras A vuelve a tomar el bloqueo e intenta mover 1.
select dblink_exec('b', 'begin') \g /dev/null
select count(*) from dblink('b', format('select cantidad from mover_unidades(%L, 2, %L, %L)',
  'b0000000-0000-0000-0000-0000000000c1', :'taller', :'listo')) as t(c int) \g /dev/null
select dblink_send_query('a', format(
  'select cantidad from mover_unidades(%L, 1, %L, %L)',
  'b0000000-0000-0000-0000-0000000000c1', :'taller', :'listo')) \g /dev/null
select pg_sleep(0.3) \g /dev/null
select dblink_exec('b', 'commit') \g /dev/null
select is((select count(*) from dblink_get_result('a', false) as t(c int)), 0::bigint,
  'concurrencia: A no puede mover la unidad que B ya se llevó');
select count(*) from dblink_get_result('a', false) as t(c int) \g /dev/null

select is((select array_agg(n order by n) from dblink('prep', format(
  $q$select coalesce(sum(case when etapa_destino_id = e.id then cantidad else 0 end), 0)
          - coalesce(sum(case when etapa_origen_id = e.id then cantidad else 0 end), 0)
       from etapas e left join movimientos m on m.linea_id = %L and e.id in (m.etapa_origen_id, m.etapa_destino_id)
      where e.area = 'afilado' group by e.id$q$, 'b0000000-0000-0000-0000-0000000000c1')) as t(n int)),
  array[0, 0, 0, 0, 6],
  'concurrencia: ninguna etapa negativa y el total sigue siendo 6 (6 en Listo)');

select dblink_exec('prep', $$
  delete from movimientos where linea_id = 'b0000000-0000-0000-0000-0000000000c1';
  delete from lineas where id = 'b0000000-0000-0000-0000-0000000000c1';
  delete from trabajos where cliente_id = 'c0000000-0000-0000-0000-0000000000c1';
  delete from clientes where id = 'c0000000-0000-0000-0000-0000000000c1';
  delete from perfiles where usuario_id in ('a0000000-0000-0000-0000-0000000000c1','a0000000-0000-0000-0000-0000000000c2');
  delete from auth.users where id in ('a0000000-0000-0000-0000-0000000000c1','a0000000-0000-0000-0000-0000000000c2');
$$) \g /dev/null
select dblink_disconnect('a') \g /dev/null
select dblink_disconnect('b') \g /dev/null
select dblink_disconnect('prep') \g /dev/null

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
insert into movimientos (linea_id, cantidad, etapa_origen_id, etapa_destino_id, usuario_id)
  values ('b0000000-0000-0000-0000-000000000001', 6, null, :'taller', 'a0000000-0000-0000-0000-000000000001');

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
  'b0000000-0000-0000-0000-000000000001', :'taller', 'a0000000-0000-0000-0000-000000000001'),
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
select is((select count(*) from movimientos where linea_id = 'b0000000-0000-0000-0000-000000000001'), 2::bigint,
  'los intentos fallidos no dejaron movimientos');
select is(unidades_en_etapa('b0000000-0000-0000-0000-000000000001', :'taller'), 2,
  'tras los fallos siguen 2 en En taller');
select throws_ok($q$delete from lineas where id = 'b0000000-0000-0000-0000-000000000001'$q$,
  '23503', null, 'no se puede borrar una línea con movimientos (historial protegido)');
select throws_ok($q$delete from trabajos where id = 'd0000000-0000-0000-0000-000000000001'$q$,
  '23503', null, 'borrar el trabajo tampoco borra el historial en cascada');

select * from finish();
rollback;
