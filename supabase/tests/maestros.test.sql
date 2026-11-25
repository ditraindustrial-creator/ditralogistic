-- Pruebas de productos (0003) y del RUT único de clientes (0004). Compatible con pgTAP y con el shim local.
\set ON_ERROR_STOP 1
\pset tuples_only on
\pset format unaligned

begin;
select plan(11);

insert into auth.users (id) values
  ('a0000000-0000-0000-0000-0000000000d1'), ('a0000000-0000-0000-0000-0000000000d2'),
  ('a0000000-0000-0000-0000-0000000000d3'), ('a0000000-0000-0000-0000-0000000000d4');
insert into perfiles (usuario_id, nombre, rol) values
  ('a0000000-0000-0000-0000-0000000000d1', 'Admin', 'admin'),
  ('a0000000-0000-0000-0000-0000000000d2', 'Secre', 'secretaria'),
  ('a0000000-0000-0000-0000-0000000000d3', 'Afilador', 'operario_afilado'),
  ('a0000000-0000-0000-0000-0000000000d4', 'Chofer', 'chofer');
insert into productos (codigo, nombre, area) values ('A-1', 'Cuchillo', 'afilado');

-- RUT único
insert into clientes (nombre, rut) values ('Uno', '12345678-5');
select throws_ok($q$insert into clientes (nombre, rut) values ('Dos', '12345678-5')$q$, '23505', null, 'el RUT de cliente es único');

-- Admin y gestión escriben
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000d1"}', true) \g /dev/null
select lives_ok($q$insert into productos (codigo, nombre, area) values ('A-2', 'Tijera', 'afilado')$q$, 'admin crea producto');
select lives_ok($q$insert into productos (codigo, nombre, area) values ('A-2', 'Tijera 2', 'afilado')
  on conflict (codigo) do update set nombre = excluded.nombre$q$, 'upsert por código actualiza sin duplicar');
select is((select count(*) from productos where codigo = 'A-2'), 1::bigint, 'un solo producto A-2');
select is((select nombre from productos where codigo = 'A-2'), 'Tijera 2', 'el upsert actualizó el nombre');
select throws_ok($q$insert into productos (codigo, nombre, area) values (' A-3', 'x', 'afilado')$q$, '23514', null, 'el código no admite espacios en los bordes');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000d2"}', true) \g /dev/null
select lives_ok($q$insert into productos (codigo, nombre, area) values ('E-1', 'Libro', 'encuadernacion')$q$, 'secretaria (gestión) crea producto');

-- Operario y chofer leen pero no escriben
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000d3"}', true) \g /dev/null
select is((select count(*) from productos), 3::bigint, 'el operario lee el catálogo completo');
select throws_ok($q$insert into productos (codigo, nombre, area) values ('X-1', 'x', 'afilado')$q$, '42501', null, 'operario no escribe productos');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000d4"}', true) \g /dev/null
select is((select count(*) from productos), 3::bigint, 'el chofer lee el catálogo');

-- Sin sesión no ve nada
select set_config('request.jwt.claims', '', true) \g /dev/null
select is((select count(*) from productos), 0::bigint, 'sin sesión no se ve el catálogo');

reset role;
select * from finish();
rollback;
