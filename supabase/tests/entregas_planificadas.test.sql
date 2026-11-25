-- Pruebas de 0011_entregas_planificadas.sql: RLS en entregas_planificadas y trabajos.entrega_planificada.
-- Compatible con pgTAP y con el shim local (scripts/sql-local/pgtap_shim.sql).
\set ON_ERROR_STOP 1
\pset tuples_only on
\pset format unaligned

begin;
select plan(16);

create function pg_temp.como(p uuid) returns void language plpgsql as $f$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', coalesce(json_build_object('sub', p)::text, ''), true);
end $f$;

-- ===================== Datos =====================
insert into auth.users (id) values
  ('e0000000-0000-0000-0000-000000001101'),
  ('e0000000-0000-0000-0000-000000001102'),
  ('e0000000-0000-0000-0000-000000001103'),
  ('e0000000-0000-0000-0000-000000001104'),
  ('e0000000-0000-0000-0000-000000001105');
insert into perfiles (usuario_id, nombre, rol) values
  ('e0000000-0000-0000-0000-000000001101', 'Admin11',    'admin'),
  ('e0000000-0000-0000-0000-000000001102', 'Secretaria11','secretaria'),
  ('e0000000-0000-0000-0000-000000001103', 'Operario11', 'operario_encuadernacion'),
  ('e0000000-0000-0000-0000-000000001104', 'Chofer11',   'chofer'),
  ('e0000000-0000-0000-0000-000000001105', 'Jefe11',     'jefe_taller');
\set admin  e0000000-0000-0000-0000-000000001101
\set sec    e0000000-0000-0000-0000-000000001102
\set op_enc e0000000-0000-0000-0000-000000001103
\set chofer e0000000-0000-0000-0000-000000001104
\set jefe   e0000000-0000-0000-0000-000000001105

insert into clientes (id, nombre, rut) values
  ('e0000000-0000-0000-0000-000000001001', 'Cliente Planif', '99-9');
insert into trabajos (id, cliente_id, area, entrada, salida) values
  ('e0000000-0000-0000-0000-000000002001', 'e0000000-0000-0000-0000-000000001001', 'encuadernacion', 'cliente', 'cliente');

-- ===================== gestión puede INSERT =====================
select pg_temp.como(:'sec') \g /dev/null
select lives_ok(
  format('insert into entregas_planificadas (trabajo_id, hora, cantidad, creado_por) values (%L, %L, 5, %L)',
    'e0000000-0000-0000-0000-000000002001', '2026-11-26 14:00:00+00', :'sec'),
  'secretaria puede insertar entrega planificada');

select pg_temp.como(:'admin') \g /dev/null
select lives_ok(
  format('insert into entregas_planificadas (trabajo_id, hora, cantidad, creado_por) values (%L, %L, 3, %L)',
    'e0000000-0000-0000-0000-000000002001', '2026-11-26 16:00:00+00', :'admin'),
  'admin puede insertar entrega planificada');

-- ===================== operario no puede INSERT =====================
select pg_temp.como(:'op_enc') \g /dev/null
select throws_ok(
  format('insert into entregas_planificadas (trabajo_id, hora, cantidad, creado_por) values (%L, %L, 2, %L)',
    'e0000000-0000-0000-0000-000000002001', '2026-11-26 15:00:00+00', :'op_enc'),
  '42501', null,
  'operario_encuadernacion no puede INSERT en entregas_planificadas');

-- ===================== chofer no puede INSERT =====================
select pg_temp.como(:'chofer') \g /dev/null
select throws_ok(
  format('insert into entregas_planificadas (trabajo_id, hora, cantidad, creado_por) values (%L, %L, 1, %L)',
    'e0000000-0000-0000-0000-000000002001', '2026-11-26 15:00:00+00', :'chofer'),
  '42501', null,
  'chofer no puede INSERT en entregas_planificadas');

-- ===================== anon no puede INSERT =====================
set role anon;
select throws_ok(
  format('insert into entregas_planificadas (trabajo_id, hora, cantidad, creado_por) values (%L, %L, 1, %L)',
    'e0000000-0000-0000-0000-000000002001', '2026-11-26 15:00:00+00', 'e0000000-0000-0000-0000-000000001101'),
  '42501', null,
  'anon no puede INSERT en entregas_planificadas');
reset role;

-- ===================== todos los perfiles pueden SELECT =====================
select pg_temp.como(:'op_enc') \g /dev/null
select lives_ok(
  'select count(*) from entregas_planificadas',
  'operario puede SELECT en entregas_planificadas');

select pg_temp.como(:'chofer') \g /dev/null
select lives_ok(
  'select count(*) from entregas_planificadas',
  'chofer puede SELECT en entregas_planificadas');

-- ===================== gestión puede UPDATE =====================
select pg_temp.como(:'sec') \g /dev/null
select lives_ok(
  format('update entregas_planificadas set cantidad = 10 where trabajo_id = %L', 'e0000000-0000-0000-0000-000000002001'),
  'secretaria puede UPDATE en entregas_planificadas');

-- ===================== gestión puede DELETE =====================
select lives_ok(
  format('delete from entregas_planificadas where trabajo_id = %L and cantidad = 10', 'e0000000-0000-0000-0000-000000002001'),
  'secretaria puede DELETE en entregas_planificadas');

-- ===================== CHECK cantidad > 0 =====================
select throws_ok(
  format('insert into entregas_planificadas (trabajo_id, hora, cantidad, creado_por) values (%L, %L, 0, %L)',
    'e0000000-0000-0000-0000-000000002001', '2026-11-26 14:00:00+00', :'sec'),
  '23514', null,
  'cantidad = 0 viola CHECK cantidad > 0');

select throws_ok(
  format('insert into entregas_planificadas (trabajo_id, hora, cantidad, creado_por) values (%L, %L, -1, %L)',
    'e0000000-0000-0000-0000-000000002001', '2026-11-26 14:00:00+00', :'sec'),
  '23514', null,
  'cantidad negativa viola CHECK cantidad > 0');

-- ===================== FK ON DELETE CASCADE =====================
select pg_temp.como(:'admin') \g /dev/null
select lives_ok(
  format('delete from trabajos where id = %L', 'e0000000-0000-0000-0000-000000002001'),
  'admin puede borrar el trabajo');
select is(
  (select count(*)::int from entregas_planificadas where trabajo_id = 'e0000000-0000-0000-0000-000000002001'),
  0,
  'las entregas planificadas se borran en cascada al borrar el trabajo');

-- ===================== entrega_planificada en trabajos =====================
insert into trabajos (id, cliente_id, area, entrada, salida) values
  ('e0000000-0000-0000-0000-000000002002', 'e0000000-0000-0000-0000-000000001001', 'encuadernacion', 'cliente', 'cliente');
select pg_temp.como(:'sec') \g /dev/null
select lives_ok(
  format('update trabajos set entrega_planificada = %L where id = %L', '2026-11-26 14:00:00+00', 'e0000000-0000-0000-0000-000000002002'),
  'secretaria puede actualizar entrega_planificada del trabajo');
select is(
  (select entrega_planificada::text from trabajos where id = 'e0000000-0000-0000-0000-000000002002'),
  '2026-11-26 14:00:00+00',
  'entrega_planificada queda guardada en el trabajo');

rollback;
