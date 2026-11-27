-- Pruebas de la numeración por área (0012): A-001, A-002… y E-001, E-002… por separado.
-- Compatible con pgTAP y con el shim local (scripts/sql-local/pgtap_shim.sql).
\set ON_ERROR_STOP 1
\pset tuples_only on
\pset format unaligned

begin;
select plan(7);

insert into auth.users (id) values ('a0000000-0000-0000-0000-0000000000a1');
insert into perfiles (usuario_id, nombre, rol) values ('a0000000-0000-0000-0000-0000000000a1', 'Secretaria', 'secretaria');
insert into clientes (id, nombre, rut) values ('c0000000-0000-0000-0000-0000000000a1', 'Cliente numeración', '77-7');

select ultimo as base_a from contadores_area where area = 'afilado' \gset
select ultimo as base_e from contadores_area where area = 'encuadernacion' \gset

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a1"}', true) \g /dev/null

select id as a1 from crear_trabajo('{"cliente_id":"c0000000-0000-0000-0000-0000000000a1","area":"afilado","entrada":"cliente",
  "lineas":[{"producto":"Cuchillo","cantidad":1}]}'::jsonb) \gset
select id as e1 from crear_trabajo('{"cliente_id":"c0000000-0000-0000-0000-0000000000a1","area":"encuadernacion","entrada":"cliente",
  "lineas":[{"producto":"Libro","cantidad":1}]}'::jsonb) \gset
select id as a2 from crear_trabajo('{"cliente_id":"c0000000-0000-0000-0000-0000000000a1","area":"afilado","entrada":"cliente",
  "lineas":[{"producto":"Tijera","cantidad":1}]}'::jsonb) \gset
select id as e2 from crear_trabajo('{"cliente_id":"c0000000-0000-0000-0000-0000000000a1","area":"encuadernacion","entrada":"cliente",
  "lineas":[{"producto":"Revista","cantidad":1}]}'::jsonb) \gset

select is((select numero_area from trabajos where id = :'a1'), :base_a + 1, 'el primer afilado toma el siguiente número de afilado');
select is((select numero_area from trabajos where id = :'a2'), :base_a + 2, 'el segundo afilado sigue la serie de afilado');
select is((select numero_area from trabajos where id = :'e1'), :base_e + 1, 'encuadernación lleva su propia serie');
select is((select numero_area from trabajos where id = :'e2'), :base_e + 2, 'y la sigue sin saltarse números por los de afilado');
select ok((select numero_area from crear_trabajo('{"cliente_id":"c0000000-0000-0000-0000-0000000000a1","area":"afilado","entrada":"cliente",
  "lineas":[{"producto":"Hacha","cantidad":1}]}'::jsonb)) = :base_a + 3, 'crear_trabajo devuelve el número del área');

select throws_ok(format($q$update trabajos set numero_area = 999 where id = %L$q$, :'a1'),
  'P0001', 'El número de un trabajo no se puede cambiar.', 'el número no se cambia');
select is((select count(*) from contadores_area), 0::bigint, 'la app no ve ni toca el contador (RLS sin políticas)');

select * from finish();
rollback;
