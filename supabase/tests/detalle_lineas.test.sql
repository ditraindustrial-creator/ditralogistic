-- Pruebas de 0010_detalle_lineas.sql: actualizar_detalle_linea y permisos por área.
-- Compatible con pgTAP y con el shim local (scripts/sql-local/pgtap_shim.sql).
\set ON_ERROR_STOP 1
\pset tuples_only on
\pset format unaligned

begin;
select plan(14);

create function pg_temp.como(p uuid) returns void language plpgsql as $f$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', coalesce(json_build_object('sub', p)::text, ''), true);
end $f$;

-- ===================== Datos =====================
insert into auth.users (id) values
  ('a0000000-0000-0000-0000-000000001001'),
  ('a0000000-0000-0000-0000-000000001002'),
  ('a0000000-0000-0000-0000-000000001003'),
  ('a0000000-0000-0000-0000-000000001004'),
  ('a0000000-0000-0000-0000-000000001005'),
  ('a0000000-0000-0000-0000-000000001006');
insert into perfiles (usuario_id, nombre, rol) values
  ('a0000000-0000-0000-0000-000000001001', 'Admin10',    'admin'),
  ('a0000000-0000-0000-0000-000000001002', 'Secretaria10','secretaria'),
  ('a0000000-0000-0000-0000-000000001003', 'Jefe10',     'jefe_taller'),
  ('a0000000-0000-0000-0000-000000001004', 'Afilador10', 'operario_afilado'),
  ('a0000000-0000-0000-0000-000000001005', 'Encuader10', 'operario_encuadernacion'),
  ('a0000000-0000-0000-0000-000000001006', 'Chofer10',   'chofer');
\set admin   a0000000-0000-0000-0000-000000001001
\set sec     a0000000-0000-0000-0000-000000001002
\set jefe    a0000000-0000-0000-0000-000000001003
\set op_af   a0000000-0000-0000-0000-000000001004
\set op_enc  a0000000-0000-0000-0000-000000001005
\set chofer  a0000000-0000-0000-0000-000000001006

insert into clientes (id, nombre, rut) values
  ('c0000000-0000-0000-0000-000000001001', 'Cliente Detalle', '11-9');
insert into trabajos (id, cliente_id, area, entrada, salida) values
  ('d0000000-0000-0000-0000-000000001001', 'c0000000-0000-0000-0000-000000001001', 'afilado',      'cliente', 'cliente'),
  ('d0000000-0000-0000-0000-000000001002', 'c0000000-0000-0000-0000-000000001001', 'encuadernacion','cliente', 'cliente');
insert into lineas (id, trabajo_id, producto, cantidad) values
  ('b0000000-0000-0000-0000-000000001011', 'd0000000-0000-0000-0000-000000001001', 'Cuchillo 115', 4),
  ('b0000000-0000-0000-0000-000000001012', 'd0000000-0000-0000-0000-000000001002', 'Libro A4',     2);

-- ===================== Pruebas de permisos =====================

-- operario_afilado puede actualizar una línea de afilado
select pg_temp.como(:'op_af') \g /dev/null
select lives_ok(
  format('select actualizar_detalle_linea(%L, %L, null)', 'b0000000-0000-0000-0000-000000001011', 'Ángulo 25°'),
  'operario_afilado puede actualizar detalle en trabajo de afilado');

-- operario_afilado NO puede actualizar una línea de encuadernación
select throws_ok(
  format('select actualizar_detalle_linea(%L, %L, null)', 'b0000000-0000-0000-0000-000000001012', 'prueba'),
  'P0001', 'Sin permiso para actualizar el detalle de esta línea.',
  'operario_afilado no puede actualizar detalle en trabajo de encuadernación');

-- operario_encuadernacion puede actualizar una línea de encuadernación
select pg_temp.como(:'op_enc') \g /dev/null
select lives_ok(
  format('select actualizar_detalle_linea(%L, %L, null)', 'b0000000-0000-0000-0000-000000001012', 'Margen 10mm'),
  'operario_encuadernacion puede actualizar detalle en trabajo de encuadernación');

-- operario_encuadernacion NO puede actualizar una línea de afilado
select throws_ok(
  format('select actualizar_detalle_linea(%L, %L, null)', 'b0000000-0000-0000-0000-000000001011', 'prueba'),
  'P0001', 'Sin permiso para actualizar el detalle de esta línea.',
  'operario_encuadernacion no puede actualizar detalle en trabajo de afilado');

-- gestión (secretaria) puede en ambos
select pg_temp.como(:'sec') \g /dev/null
select lives_ok(
  format('select actualizar_detalle_linea(%L, %L, null)', 'b0000000-0000-0000-0000-000000001011', 'Secretaria af'),
  'gestión (secretaria) puede actualizar detalle en afilado');
select lives_ok(
  format('select actualizar_detalle_linea(%L, %L, null)', 'b0000000-0000-0000-0000-000000001012', 'Secretaria enc'),
  'gestión (secretaria) puede actualizar detalle en encuadernación');

-- gestión (jefe) puede en ambos
select pg_temp.como(:'jefe') \g /dev/null
select lives_ok(
  format('select actualizar_detalle_linea(%L, %L, null)', 'b0000000-0000-0000-0000-000000001011', 'Jefe af'),
  'gestión (jefe_taller) puede actualizar detalle en afilado');

-- chofer no puede
select pg_temp.como(:'chofer') \g /dev/null
select throws_ok(
  format('select actualizar_detalle_linea(%L, %L, null)', 'b0000000-0000-0000-0000-000000001011', 'prueba'),
  'P0001', 'Sin permiso para actualizar el detalle de esta línea.',
  'chofer no puede actualizar detalle');

-- anon no puede (sin GRANT a anon, solo a authenticated)
set role anon;
select throws_ok(
  format('select actualizar_detalle_linea(%L, %L, null)', 'b0000000-0000-0000-0000-000000001011', 'prueba'),
  '42501', null,
  'anon no puede ejecutar actualizar_detalle_linea (sin GRANT)');
reset role;

-- ===================== El valor se guarda =====================
select pg_temp.como(:'op_af') \g /dev/null
select lives_ok(
  format('select actualizar_detalle_linea(%L, %L, null)', 'b0000000-0000-0000-0000-000000001011', 'Ángulo 30° melladura leve'),
  'preparar valor final');
select is(
  (select detalle_taller from lineas where id = 'b0000000-0000-0000-0000-000000001011'),
  'Ángulo 30° melladura leve',
  'detalle_taller queda guardado con el valor pasado');

-- servicio_id NULL queda NULL
select pg_temp.como(:'sec') \g /dev/null
select lives_ok(
  format('select actualizar_detalle_linea(%L, null, null)', 'b0000000-0000-0000-0000-000000001012'),
  'borrar detalle con NULL');
select is(
  (select detalle_taller from lineas where id = 'b0000000-0000-0000-0000-000000001012'),
  null,
  'detalle_taller queda NULL cuando se pasa NULL');

rollback;
