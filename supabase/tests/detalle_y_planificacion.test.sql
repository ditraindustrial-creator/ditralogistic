-- Pruebas de 0010_detalle_y_planificacion.sql: servicio y detalle del taller por línea, tipo de
-- producto, y horas planificadas de entrega (trabajo completo y parciales) en encuadernación.
-- Compatible con pgTAP y con el shim local (scripts/sql-local/pgtap_shim.sql).
\set ON_ERROR_STOP 1
\pset tuples_only on
\pset format unaligned

begin;
select plan(42);

create function pg_temp.como(p uuid) returns void language plpgsql as $f$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', coalesce(json_build_object('sub', p)::text, ''), true);
end $f$;
create function pg_temp.sin_sesion() returns void language plpgsql as $f$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $f$;

\set admin 'a0000000-0000-0000-0000-000000001001'
\set sec 'a0000000-0000-0000-0000-000000001002'
\set jefe 'a0000000-0000-0000-0000-000000001003'
\set chofer 'a0000000-0000-0000-0000-000000001004'
\set opaf 'a0000000-0000-0000-0000-000000001005'
\set openc 'a0000000-0000-0000-0000-000000001006'
\set c1 'c0000000-0000-0000-0000-000000001001'
\set taf 'b0000000-0000-0000-0000-000000001001'
\set ten 'b0000000-0000-0000-0000-000000001002'
\set laf 'd0000000-0000-0000-0000-000000001001'
\set len 'd0000000-0000-0000-0000-000000001002'

insert into auth.users (id) values (:'admin'), (:'sec'), (:'jefe'), (:'chofer'), (:'opaf'), (:'openc');
insert into perfiles (usuario_id, nombre, rol) values
  (:'admin', 'Admin', 'admin'), (:'sec', 'Secre', 'secretaria'), (:'jefe', 'Jefe', 'jefe_taller'),
  (:'chofer', 'Rodrigo Lagos', 'chofer'), (:'opaf', 'Afilador', 'operario_afilado'), (:'openc', 'Encuadernador', 'operario_encuadernacion');
insert into clientes (id, nombre, rut) values (:'c1', 'Imprenta Sur', '90000101-1');
insert into trabajos (id, cliente_id, area, entrada, salida) values
  (:'taf', :'c1', 'afilado', 'ruta_propia', 'ruta_propia'),
  (:'ten', :'c1', 'encuadernacion', 'cliente', 'cliente');
insert into lineas (id, trabajo_id, producto, cantidad) values
  (:'laf', :'taf', 'Cuchillo recto', 3),
  (:'len', :'ten', 'Libro tapa dura', 100);

-- ===================== Esquema =====================
insert into productos (codigo, nombre, area) values ('H-1', 'Cuchillo recto', 'afilado');
select is((select tipo from productos where codigo = 'H-1'), 'herramienta', 'un producto sin tipo queda como herramienta');
select lives_ok($q$insert into productos (codigo, nombre, area, tipo) values ('S-1', 'Afilado recto', 'afilado', 'servicio')$q$,
  'se puede importar un servicio');
select throws_ok($q$insert into productos (codigo, nombre, area, tipo) values ('X-1', 'Raro', 'afilado', 'repuesto')$q$,
  '23514', null, 'el tipo solo es herramienta o servicio');
select throws_ok(format($q$update trabajos set entrega_planificada = '2026-11-26 15:00' where id = %L$q$, :'taf'),
  '23514', null, 'un trabajo de afilado no tiene hora planificada');
select throws_ok(format($q$update lineas set servicio = '   ' where id = %L$q$, :'laf'),
  '23514', null, 'el servicio no puede ser solo espacios');

-- ===================== guardar_detalle_linea =====================
select pg_temp.como(:'opaf') \g /dev/null
select lives_ok(format($q$select guardar_detalle_linea(%L, '  Afilado recto ', 'Ángulo 20°, melladura leve')$q$, :'laf'),
  'el operario de afilado completa el detalle de una línea de afilado');
select pg_temp.sin_sesion() \g /dev/null
select is((select row(servicio, detalle_taller)::text from lineas where id = :'laf'),
  row('Afilado recto', 'Ángulo 20°, melladura leve')::text, 'se guardan servicio (recortado) y detalle');
select pg_temp.como(:'opaf') \g /dev/null
select throws_ok(format($q$select guardar_detalle_linea(%L, 'Anillado', null)$q$, :'len'),
  '42501', 'No tienes permiso para cambiar el detalle de esta línea.', 'el operario de afilado no toca encuadernación');
select lives_ok(format($q$update lineas set servicio = 'x' where id = %L$q$, :'laf'),
  'un update directo del operario no falla, pero RLS no le deja tocar filas');
select pg_temp.sin_sesion() \g /dev/null
select is((select servicio from lineas where id = :'laf'), 'Afilado recto', 'un update directo del operario no cambia la línea');

select pg_temp.como(:'openc') \g /dev/null
select lives_ok(format($q$select guardar_detalle_linea(%L, 'Empaste tapa dura', 'Hilo blanco')$q$, :'len'),
  'el operario de encuadernación detalla su área');
select pg_temp.como(:'chofer') \g /dev/null
select throws_ok(format($q$select guardar_detalle_linea(%L, 'Afilado', null)$q$, :'laf'),
  '42501', 'No tienes permiso para cambiar el detalle de esta línea.', 'el chofer no define el servicio');
select pg_temp.como(:'sec') \g /dev/null
select lives_ok(format($q$select guardar_detalle_linea(%L, '', '  ')$q$, :'laf'), 'gestión puede borrar el detalle');
select pg_temp.sin_sesion() \g /dev/null
select is((select row(servicio, detalle_taller)::text from lineas where id = :'laf'), row(null::text, null::text)::text,
  'texto vacío queda como sin dato');
select pg_temp.como(:'jefe') \g /dev/null
select throws_ok(format($q$select guardar_detalle_linea(%L, %L, null)$q$, :'laf', repeat('x', 201)),
  'P0001', 'El servicio puede tener hasta 200 caracteres.', 'servicio largo rechazado en español');
select throws_ok(format($q$select guardar_detalle_linea(%L, null, %L)$q$, :'laf', repeat('x', 1001)),
  'P0001', 'El detalle puede tener hasta 1000 caracteres.', 'detalle largo rechazado en español');
select throws_ok($q$select guardar_detalle_linea('d0000000-0000-0000-0000-0000000010ff', 'x', null)$q$,
  'P0001', 'La línea no existe.', 'línea inexistente');
select pg_temp.como(null) \g /dev/null
select throws_ok(format($q$select guardar_detalle_linea(%L, 'x', null)$q$, :'laf'),
  '42501', 'Debes iniciar sesión para guardar el detalle.', 'sin sesión no se guarda');

-- ===================== planificar_entregas =====================
select pg_temp.como(:'openc') \g /dev/null
select lives_ok(format($q$select planificar_entregas(%L, '2026-11-28 15:00', %L::jsonb)$q$, :'ten',
  '[{"planificada":"2026-11-27T10:00","cantidad":60,"nota":" resto "},{"planificada":"2026-11-26T10:00","cantidad":40}]'),
  'el operario de encuadernación planifica hora total y dos parciales');
select pg_temp.sin_sesion() \g /dev/null
select is((select entrega_planificada from trabajos where id = :'ten'), '2026-11-28 15:00'::timestamp, 'hora del trabajo guardada');
select is((select string_agg(to_char(planificada, 'DD HH24:MI') || '=' || coalesce(cantidad::text, '-') || '/' || coalesce(nota, ''), ', ' order by planificada)
             from entregas_parciales where trabajo_id = :'ten'),
  '26 10:00=40/, 27 10:00=60/resto', 'parciales guardadas con cantidad y nota recortada');

select pg_temp.como(:'sec') \g /dev/null
select lives_ok(format($q$select planificar_entregas(%L, null, '[{"planificada":"2026-11-29T09:00"}]'::jsonb)$q$, :'ten'),
  'gestión reemplaza el plan (sin hora total, una parcial sin cantidad)');
select pg_temp.sin_sesion() \g /dev/null
select is((select count(*) from entregas_parciales where trabajo_id = :'ten'), 1::bigint, 'el plan anterior se reemplazó completo');
select is((select entrega_planificada from trabajos where id = :'ten'), null::timestamp, 'la hora total se quitó');

select pg_temp.como(:'sec') \g /dev/null
select throws_ok(format($q$select planificar_entregas(%L, null, '[{"planificada":"2026-11-26T10:00","cantidad":70},{"planificada":"2026-11-27T10:00","cantidad":40}]'::jsonb)$q$, :'ten'),
  'P0001', 'Las entregas parciales suman 110 unidades, pero el trabajo tiene 100.', 'las parciales no suman más que el trabajo');
select pg_temp.sin_sesion() \g /dev/null
select is((select count(*) from entregas_parciales where trabajo_id = :'ten'), 1::bigint, 'un plan rechazado no cambia nada (todo o nada)');
select pg_temp.como(:'sec') \g /dev/null
select throws_ok(format($q$select planificar_entregas(%L, null, '[{"cantidad":5}]'::jsonb)$q$, :'ten'),
  'P0001', 'Falta la fecha y hora de la entrega parcial 1.', 'parcial sin hora');
select throws_ok(format($q$select planificar_entregas(%L, null, '[{"planificada":"2026-11-26T10:00","cantidad":0}]'::jsonb)$q$, :'ten'),
  'P0001', 'La cantidad de la entrega parcial 1 debe ser un número entero mayor que cero.', 'cantidad cero');
select throws_ok(format($q$select planificar_entregas(%L, null, '[{"planificada":"mañana"}]'::jsonb)$q$, :'ten'),
  '22007', null, 'hora ilegible da error de fecha (la app lo traduce)');
select throws_ok(format($q$select planificar_entregas(%L, null, '{"planificada":"2026-11-26T10:00"}'::jsonb)$q$, :'ten'),
  'P0001', 'Las entregas parciales no son válidas.', 'parciales que no son lista');
select throws_ok(format($q$select planificar_entregas(%L, '2026-11-26 10:00', '[]'::jsonb)$q$, :'taf'),
  'P0001', 'Solo los trabajos de encuadernación tienen hora planificada.', 'afilado no se planifica');
select throws_ok($q$select planificar_entregas('b0000000-0000-0000-0000-0000000010ff', null, '[]'::jsonb)$q$,
  'P0001', 'El trabajo no existe.', 'trabajo inexistente');

select pg_temp.como(:'opaf') \g /dev/null
select throws_ok(format($q$select planificar_entregas(%L, '2026-11-26 10:00', '[]'::jsonb)$q$, :'ten'),
  '42501', 'No tienes permiso para planificar entregas.', 'el operario de afilado no planifica');
select pg_temp.como(:'chofer') \g /dev/null
select throws_ok(format($q$select planificar_entregas(%L, '2026-11-26 10:00', '[]'::jsonb)$q$, :'ten'),
  '42501', 'No tienes permiso para planificar entregas.', 'el chofer no planifica');
select throws_ok(format($q$update trabajos set entrega_planificada = '2026-11-26 10:00' where id = %L$q$, :'ten'),
  '42501', 'Solo puedes cambiar la salida, la guía de despacho y el transporte de un trabajo.',
  'el chofer tampoco cambia la hora planificada con un update directo');
select lives_ok(format($q$update trabajos set salida = 'ruta_propia' where id = %L$q$, :'ten'),
  'el chofer sigue pudiendo cambiar la salida');

-- ===================== Lectura (RLS) =====================
select is((select count(*) from entregas_parciales), 1::bigint, 'el chofer ve las parciales (las necesita en la hoja)');
select pg_temp.como(:'opaf') \g /dev/null
select is((select count(*) from entregas_parciales), 0::bigint, 'el operario de afilado no ve parciales de encuadernación');
select pg_temp.como(:'openc') \g /dev/null
select is((select count(*) from entregas_parciales), 1::bigint, 'el operario de encuadernación las ve');
select throws_ok(format($q$insert into entregas_parciales (trabajo_id, planificada) values (%L, '2026-11-26 10:00')$q$, :'ten'),
  '42501', null, 'nadie escribe parciales directo: solo con planificar_entregas');
select pg_temp.como(:'admin') \g /dev/null
select lives_ok(format($q$delete from entregas_parciales where trabajo_id = %L$q$, :'ten'),
  'gestión intenta borrar directo (RLS no tiene política de borrado)');
select pg_temp.sin_sesion() \g /dev/null
select is((select count(*) from entregas_parciales where trabajo_id = :'ten'), 1::bigint, 'el borrado directo no hizo nada');

select * from finish();
rollback;
