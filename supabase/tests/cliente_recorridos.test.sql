-- Pruebas de 0009_cliente_recorridos.sql: un cliente en varios recorridos (fijo o a pedido).
-- Compatible con pgTAP y con el shim local (scripts/sql-local/pgtap_shim.sql).
\set ON_ERROR_STOP 1
\pset tuples_only on
\pset format unaligned

begin;
select plan(53);

-- Cambia de usuario (rol authenticated + sub del JWT); null = sin sesión.
create function pg_temp.como(p uuid) returns void language plpgsql as $f$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', coalesce(json_build_object('sub', p)::text, ''), true);
end $f$;

\set admin 'a0000000-0000-0000-0000-000000000901'
\set sec 'a0000000-0000-0000-0000-000000000902'
\set jefe 'a0000000-0000-0000-0000-000000000903'
\set chofer 'a0000000-0000-0000-0000-000000000904'
\set opaf 'a0000000-0000-0000-0000-000000000905'
\set openc 'a0000000-0000-0000-0000-000000000906'
\set sinperfil 'a0000000-0000-0000-0000-000000000907'
\set lun 'e0000000-0000-0000-0000-000000000901'
\set mie 'e0000000-0000-0000-0000-000000000903'
\set vie 'e0000000-0000-0000-0000-000000000905'
\set c1 'c0000000-0000-0000-0000-000000000901'
\set c2 'c0000000-0000-0000-0000-000000000902'
\set c3 'c0000000-0000-0000-0000-000000000903'

insert into auth.users (id) values (:'admin'), (:'sec'), (:'jefe'), (:'chofer'), (:'opaf'), (:'openc'), (:'sinperfil');
insert into perfiles (usuario_id, nombre, rol) values
  (:'admin', 'Admin', 'admin'), (:'sec', 'Secre', 'secretaria'), (:'jefe', 'Jefe', 'jefe_taller'),
  (:'chofer', 'Rodrigo Lagos', 'chofer'), (:'opaf', 'Afilador', 'operario_afilado'), (:'openc', 'Encuadernador', 'operario_encuadernacion');
insert into recorridos (id, nombre, dia, camioneta, chofer) values
  (:'lun', 'Lunes · Rodrigo Lagos', 1, 'Camioneta 1', 'Rodrigo Lagos'),
  (:'mie', 'Miércoles · Rodrigo Lagos', 3, 'Camioneta 1', 'Rodrigo Lagos'),
  (:'vie', 'Viernes · Angelo', 5, 'Camioneta 2', 'Angelo');
insert into clientes (id, nombre, rut) values
  (:'c1', 'Imprenta Sur', '90000001-1'), (:'c2', 'Libros del Norte', '90000002-K'), (:'c3', 'Costa Print', '90000003-8');

-- ===================== Esquema =====================
select ok(not exists (select 1 from information_schema.columns
                      where table_schema = 'public' and table_name = 'clientes' and column_name = 'recorrido_id'),
  'clientes ya no tiene recorrido_id (un cliente puede estar en varios recorridos)');
select ok(exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'recorridos' and column_name = 'chofer' and is_nullable = 'YES'),
  'recorridos tiene chofer (opcional)');
select is((select chofer from recorridos where id = :'vie'), 'Angelo', 'el chofer titular se guarda');

-- Un cliente en lunes, miércoles y viernes (como en la hoja real); defaults fija = true, orden = 0.
insert into cliente_recorridos (cliente_id, recorrido_id) values (:'c1', :'lun');
select is((select row(fija, orden)::text from cliente_recorridos where cliente_id = :'c1' and recorrido_id = :'lun'),
  row(true, 0)::text, 'por defecto la asignación es fija y con orden 0');
select lives_ok(format($q$insert into cliente_recorridos (cliente_id, recorrido_id, fija, orden) values
  (%L, %L, true, 3), (%L, %L, false, 7)$q$, :'c1', :'mie', :'c1', :'vie'), 'el mismo cliente queda en varios recorridos');
select is((select count(*) from cliente_recorridos where cliente_id = :'c1'), 3::bigint, 'tres asignaciones del mismo cliente');
select throws_ok(format($q$insert into cliente_recorridos (cliente_id, recorrido_id) values (%L, %L)$q$, :'c1', :'lun'),
  '23505', null, 'una sola asignación por cliente y recorrido');
select throws_ok(format($q$insert into cliente_recorridos (cliente_id, recorrido_id, orden) values (%L, %L, -1)$q$, :'c2', :'lun'),
  '23514', null, 'el orden no puede ser negativo');
select throws_ok(format($q$insert into cliente_recorridos (cliente_id, recorrido_id, fija) values (%L, %L, null)$q$, :'c2', :'lun'),
  '23502', null, 'fija no admite null');
select throws_ok(format($q$insert into cliente_recorridos (cliente_id, recorrido_id) values (%L, 'e0000000-0000-0000-0000-0000000009ff')$q$, :'c2'),
  '23503', null, 'el recorrido debe existir');
select throws_ok(format($q$insert into cliente_recorridos (cliente_id, recorrido_id) values ('c0000000-0000-0000-0000-0000000009ff', %L)$q$, :'lun'),
  '23503', null, 'el cliente debe existir');

-- ===================== RLS: gestión escribe =====================
select pg_temp.como(:'admin') \g /dev/null
select lives_ok(format($q$insert into cliente_recorridos (cliente_id, recorrido_id) values (%L, %L)$q$, :'c2', :'lun'), 'admin asigna');
select lives_ok(format($q$insert into cliente_recorridos (cliente_id, recorrido_id, fija, orden) values (%L, %L, false, 2)
  on conflict (cliente_id, recorrido_id) do update set fija = excluded.fija, orden = excluded.orden$q$, :'c2', :'lun'),
  'admin hace upsert por (cliente, recorrido)');
select is((select row(fija, orden)::text from cliente_recorridos where cliente_id = :'c2' and recorrido_id = :'lun'),
  row(false, 2)::text, 'el upsert cambió fija y orden sin duplicar');
with d as (delete from cliente_recorridos where cliente_id = :'c2' and recorrido_id = :'lun' returning 1)
select is((select count(*) from d), 1::bigint, 'admin quita una asignación');

select pg_temp.como(:'sec') \g /dev/null
select lives_ok(format($q$insert into cliente_recorridos (cliente_id, recorrido_id) values (%L, %L)$q$, :'c2', :'mie'), 'secretaria asigna');
with u as (update cliente_recorridos set orden = 5 where cliente_id = :'c2' and recorrido_id = :'mie' returning 1)
select is((select count(*) from u), 1::bigint, 'secretaria cambia el orden');
with d as (delete from cliente_recorridos where cliente_id = :'c2' and recorrido_id = :'mie' returning 1)
select is((select count(*) from d), 1::bigint, 'secretaria quita una asignación');

select pg_temp.como(:'jefe') \g /dev/null
select lives_ok(format($q$insert into cliente_recorridos (cliente_id, recorrido_id, fija) values (%L, %L, false)$q$, :'c2', :'vie'),
  'jefe de taller asigna (a pedido)');
with u as (update cliente_recorridos set fija = true where cliente_id = :'c2' and recorrido_id = :'vie' returning 1)
select is((select count(*) from u), 1::bigint, 'jefe de taller cambia fija');
select throws_ok(format($q$update cliente_recorridos set orden = -3 where cliente_id = %L and recorrido_id = %L$q$, :'c2', :'vie'),
  '23514', null, 'tampoco gestión deja un orden negativo');
with d as (delete from cliente_recorridos where cliente_id = :'c2' and recorrido_id = :'vie' returning 1)
select is((select count(*) from d), 1::bigint, 'jefe de taller quita una asignación');

-- ===================== RLS: chofer y operarios solo leen =====================
select pg_temp.como(:'chofer') \g /dev/null
select is((select count(*) from cliente_recorridos), 3::bigint, 'el chofer lee las asignaciones');
select throws_ok(format($q$insert into cliente_recorridos (cliente_id, recorrido_id) values (%L, %L)$q$, :'c3', :'lun'),
  '42501', null, 'el chofer no asigna');
with u as (update cliente_recorridos set orden = 9 returning 1)
select is((select count(*) from u), 0::bigint, 'el chofer no cambia el orden');
with d as (delete from cliente_recorridos returning 1)
select is((select count(*) from d), 0::bigint, 'el chofer no quita asignaciones');

select pg_temp.como(:'opaf') \g /dev/null
select is((select count(*) from cliente_recorridos), 3::bigint, 'el operario de afilado lee las asignaciones');
select throws_ok(format($q$insert into cliente_recorridos (cliente_id, recorrido_id) values (%L, %L)$q$, :'c3', :'lun'),
  '42501', null, 'el operario de afilado no asigna');
with u as (update cliente_recorridos set fija = false returning 1)
select is((select count(*) from u), 0::bigint, 'el operario de afilado no cambia asignaciones');
with d as (delete from cliente_recorridos returning 1)
select is((select count(*) from d), 0::bigint, 'el operario de afilado no quita asignaciones');

select pg_temp.como(:'openc') \g /dev/null
select is((select count(*) from cliente_recorridos), 3::bigint, 'el operario de encuadernación lee las asignaciones');
select throws_ok(format($q$insert into cliente_recorridos (cliente_id, recorrido_id) values (%L, %L)$q$, :'c3', :'lun'),
  '42501', null, 'el operario de encuadernación no asigna');
with u as (update cliente_recorridos set orden = 1 returning 1)
select is((select count(*) from u), 0::bigint, 'el operario de encuadernación no cambia asignaciones');
with d as (delete from cliente_recorridos returning 1)
select is((select count(*) from d), 0::bigint, 'el operario de encuadernación no quita asignaciones');

-- ===================== Sin perfil y sin sesión =====================
select pg_temp.como(:'sinperfil') \g /dev/null
select is((select count(*) from cliente_recorridos), 0::bigint, 'un usuario sin perfil no ve asignaciones');
select throws_ok(format($q$insert into cliente_recorridos (cliente_id, recorrido_id) values (%L, %L)$q$, :'c3', :'lun'),
  '42501', null, 'un usuario sin perfil no asigna');
with u as (update cliente_recorridos set orden = 1 returning 1)
select is((select count(*) from u), 0::bigint, 'un usuario sin perfil no cambia asignaciones');
with d as (delete from cliente_recorridos returning 1)
select is((select count(*) from d), 0::bigint, 'un usuario sin perfil no quita asignaciones');

select pg_temp.como(null) \g /dev/null
select is((select count(*) from cliente_recorridos), 0::bigint, 'authenticated sin sub no ve asignaciones');

-- anon: en Supabase tiene privilegios de tabla por defecto; aquí se los damos (solo en esta transacción)
-- para probar que es RLS (políticas solo para authenticated) lo que lo deja fuera.
reset role;
grant select, insert, update, delete on cliente_recorridos to anon;
set local role anon;
select set_config('request.jwt.claims', '', true) \g /dev/null
select is((select count(*) from cliente_recorridos), 0::bigint, 'anon no ve asignaciones');
select throws_ok(format($q$insert into cliente_recorridos (cliente_id, recorrido_id) values (%L, %L)$q$, :'c3', :'lun'),
  '42501', null, 'anon no asigna');
with u as (update cliente_recorridos set orden = 1 returning 1)
select is((select count(*) from u), 0::bigint, 'anon no cambia asignaciones');
with d as (delete from cliente_recorridos returning 1)
select is((select count(*) from d), 0::bigint, 'anon no quita asignaciones');
reset role;

select is((select string_agg(recorrido_id::text || ':' || fija || ':' || orden, ',' order by recorrido_id) from cliente_recorridos),
  format('%s:true:0,%s:true:3,%s:false:7', :'lun', :'mie', :'vie'), 'nadie sin permiso cambió nada');

-- ===================== Recorridos: chofer opcional, solo admin =====================
select pg_temp.como(:'admin') \g /dev/null
select lives_ok($q$insert into recorridos (nombre, dia, camioneta) values ('Martes · Angelo', 2, 'Camioneta 2')$q$,
  'el chofer del recorrido es opcional');
with u as (update recorridos set chofer = 'Angelo' where nombre = 'Martes · Angelo' returning 1)
select is((select count(*) from u), 1::bigint, 'admin anota el chofer titular');
select pg_temp.como(:'chofer') \g /dev/null
with u as (update recorridos set chofer = 'Otro' returning 1)
select is((select count(*) from u), 0::bigint, 'el chofer no cambia los recorridos');
reset role;

-- ===================== Borrado en cascada =====================
insert into cliente_recorridos (cliente_id, recorrido_id) values (:'c2', :'lun'), (:'c2', :'vie'), (:'c3', :'vie');
select pg_temp.como(:'admin') \g /dev/null
select lives_ok(format($q$delete from clientes where id = %L$q$, :'c2'), 'admin borra un cliente con asignaciones');
select is((select count(*) from cliente_recorridos where cliente_id = :'c2'), 0::bigint, 'sus asignaciones se borraron con él');
select lives_ok(format($q$delete from recorridos where id = %L$q$, :'vie'), 'admin borra un recorrido con clientes');
select is((select count(*) from cliente_recorridos where recorrido_id = :'vie'), 0::bigint, 'sus asignaciones se borraron con él');
select is((select count(*) from cliente_recorridos), 2::bigint, 'las demás asignaciones siguen (c1 en lunes y miércoles)');
select is((select count(*) from clientes where id in (:'c1', :'c3')), 2::bigint, 'borrar un recorrido no borra clientes');
reset role;

select * from finish();
rollback;
