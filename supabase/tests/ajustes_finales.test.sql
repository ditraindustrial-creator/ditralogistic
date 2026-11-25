-- Pruebas de 0008_ajustes_finales.sql: correcciones desde la etapa final, entregas solo por
-- entregar_unidades, claves de idempotencia, transporte y guía de despacho que solo se completa.
-- Compatible con pgTAP y con el shim local (scripts/sql-local/pgtap_shim.sql). La carrera de dos
-- llamadas simultáneas con la misma clave es scripts/sql-local/carrera_clave_idempotencia.sh.
\set ON_ERROR_STOP 1
\pset tuples_only on
\pset format unaligned

begin;
select plan(58);

select id as recibido from etapas where area = 'afilado' and nombre = 'Recibido' \gset
select id as taller from etapas where area = 'afilado' and nombre = 'En taller' \gset
select id as listo from etapas where area = 'afilado' and nombre = 'Listo' \gset
select id as entregado from etapas where area = 'afilado' and nombre = 'Entregado' \gset

create function pg_temp.como(p uuid) returns void language plpgsql as $f$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', coalesce(json_build_object('sub', p)::text, ''), true);
end $f$;

-- ===================== Datos (se revierten al final) =====================
insert into auth.users (id) values
  ('a0000000-0000-0000-0000-000000000801'), ('a0000000-0000-0000-0000-000000000802'),
  ('a0000000-0000-0000-0000-000000000803'), ('a0000000-0000-0000-0000-000000000804'),
  ('a0000000-0000-0000-0000-000000000805'), ('a0000000-0000-0000-0000-000000000806');
insert into perfiles (usuario_id, nombre, rol) values
  ('a0000000-0000-0000-0000-000000000801', 'Secretaria', 'secretaria'),
  ('a0000000-0000-0000-0000-000000000802', 'Chofer', 'chofer'),
  ('a0000000-0000-0000-0000-000000000803', 'Afilador', 'operario_afilado'),
  ('a0000000-0000-0000-0000-000000000804', 'Jefe', 'jefe_taller'),
  ('a0000000-0000-0000-0000-000000000805', 'Admin', 'admin'),
  ('a0000000-0000-0000-0000-000000000806', 'Chofer 2', 'chofer');
\set sec a0000000-0000-0000-0000-000000000801
\set chofer a0000000-0000-0000-0000-000000000802
\set operario a0000000-0000-0000-0000-000000000803
\set jefe a0000000-0000-0000-0000-000000000804
\set admin a0000000-0000-0000-0000-000000000805
\set chofer2 a0000000-0000-0000-0000-000000000806
insert into clientes (id, nombre, rut) values ('c0000000-0000-0000-0000-000000000801', 'Cliente ajustes', '8-6');

insert into trabajos (id, cliente_id, area, entrada, salida) values
  ('d0000000-0000-0000-0000-000000000801', 'c0000000-0000-0000-0000-000000000801', 'afilado', 'encomienda', 'encomienda'),
  ('d0000000-0000-0000-0000-000000000802', 'c0000000-0000-0000-0000-000000000801', 'afilado', 'ruta_propia', 'ruta_propia');
insert into lineas (id, trabajo_id, producto, cantidad) values
  ('b0000000-0000-0000-0000-000000000811', 'd0000000-0000-0000-0000-000000000801', 'Cuchillo', 10),
  ('b0000000-0000-0000-0000-000000000812', 'd0000000-0000-0000-0000-000000000802', 'Disco', 6);
insert into movimientos (linea_id, cantidad, etapa_origen_id, etapa_destino_id, usuario_id) values
  ('b0000000-0000-0000-0000-000000000811', 10, null, :'recibido', :'sec'),
  ('b0000000-0000-0000-0000-000000000811', 10, :'recibido', :'listo', :'sec'),
  ('b0000000-0000-0000-0000-000000000812', 6, null, :'recibido', :'sec'),
  ('b0000000-0000-0000-0000-000000000812', 6, :'recibido', :'listo', :'sec');

-- ===================== Entregar solo con documento (app.entrega_ok) =====================
select pg_temp.como(:'sec') \g /dev/null
select throws_ok(format('select mover_unidades(%L, 1, %L, %L)', 'b0000000-0000-0000-0000-000000000811', :'listo', :'entregado'),
  'P0001', 'Las entregas se registran con «Entregar», anotando el número de guía o factura.',
  'la secretaria no lleva unidades a la etapa final con mover_unidades');
select pg_temp.como(:'admin') \g /dev/null
select throws_ok(format('select mover_unidades(%L, 1, %L, %L)', 'b0000000-0000-0000-0000-000000000811', :'listo', :'entregado'),
  'P0001', 'Las entregas se registran con «Entregar», anotando el número de guía o factura.',
  'ni el administrador');
select throws_ok(format($q$insert into movimientos (linea_id, cantidad, etapa_origen_id, etapa_destino_id, usuario_id)
    values ('b0000000-0000-0000-0000-000000000811', 1, %L, %L, %L)$q$, :'listo', :'entregado', :'admin'),
  'P0001', 'Las entregas se registran con «Entregar», anotando el número de guía o factura.',
  'tampoco con un insert directo en movimientos');
select pg_temp.como(:'chofer') \g /dev/null
select throws_ok(format('select mover_unidades(%L, 1, %L, %L)', 'b0000000-0000-0000-0000-000000000811', :'listo', :'entregado'),
  'P0001', 'Las entregas se registran con «Entregar», anotando el número de guía o factura.', 'ni el chofer');
select throws_ok($q$select set_config('app.entrega_ok', '0', true), mover_unidades('b0000000-0000-0000-0000-000000000811', 1,
    (select id from etapas where area = 'afilado' and nombre = 'Listo'), (select id from etapas where area = 'afilado' and nombre = 'Entregado'))$q$,
  'P0001', 'Las entregas se registran con «Entregar», anotando el número de guía o factura.', 'un valor distinto de 1 no autoriza');
select lives_ok($q$select entregar_unidades('[{"linea_id":"b0000000-0000-0000-0000-000000000811","cantidad":4}]', 'G-1')$q$,
  'entregar_unidades sí entrega (con documento)');
select is(current_setting('app.entrega_ok', true), '', 'después de entregar_unidades la transacción ya no queda autorizada');
select throws_ok(format('select mover_unidades(%L, 1, %L, %L)', 'b0000000-0000-0000-0000-000000000811', :'listo', :'entregado'),
  'P0001', 'Las entregas se registran con «Entregar», anotando el número de guía o factura.',
  'y un mover_unidades posterior en la misma transacción sigue rechazado');
select is(unidades_en_etapa('b0000000-0000-0000-0000-000000000811', :'entregado'), 4, 'solo quedaron las 4 entregadas con documento');

-- ===================== Corrección: sacar unidades de la etapa final =====================
select pg_temp.como(:'operario') \g /dev/null
select throws_ok(format('select mover_unidades(%L, 1, %L, %L)', 'b0000000-0000-0000-0000-000000000811', :'entregado', :'listo'),
  '42501', 'Solo secretaría, jefe de taller o administración pueden sacar unidades de una etapa de entrega.',
  'un operario no saca unidades de Entregado');
select throws_ok(format('select mover_unidades(%L, 1, %L, %L)', 'b0000000-0000-0000-0000-000000000811', :'entregado', :'taller'),
  '42501', 'Solo secretaría, jefe de taller o administración pueden sacar unidades de una etapa de entrega.',
  'ni hacia otra etapa intermedia');
select pg_temp.como(:'chofer') \g /dev/null
select throws_ok(format('select mover_unidades(%L, 1, %L, %L)', 'b0000000-0000-0000-0000-000000000811', :'entregado', :'listo'),
  '42501', 'Solo secretaría, jefe de taller o administración pueden sacar unidades de una etapa de entrega.',
  'un chofer tampoco');
select pg_temp.como(:'sec') \g /dev/null
select lives_ok(format('select mover_unidades(%L, 1, %L, %L)', 'b0000000-0000-0000-0000-000000000811', :'entregado', :'listo'),
  'la secretaria sí devuelve una unidad de Entregado a Listo (corrección)');
select pg_temp.como(:'jefe') \g /dev/null
select lives_ok(format('select mover_unidades(%L, 1, %L, %L)', 'b0000000-0000-0000-0000-000000000811', :'entregado', :'taller'),
  'el jefe de taller también corrige');
select pg_temp.como(:'admin') \g /dev/null
select lives_ok(format('select mover_unidades(%L, 1, %L, %L)', 'b0000000-0000-0000-0000-000000000811', :'entregado', :'listo'),
  'y el administrador');
select is(unidades_en_etapa('b0000000-0000-0000-0000-000000000811', :'entregado'), 1, 'quedó 1 en Entregado tras las 3 correcciones');
select pg_temp.como(:'operario') \g /dev/null
select lives_ok(format('select mover_unidades(%L, 1, %L, %L)', 'b0000000-0000-0000-0000-000000000811', :'listo', :'taller'),
  'el operario sigue moviendo hacia atrás entre etapas no finales');

-- ===================== Guía de despacho: solo se completa (no gestión) =====================
-- Tras la entrega G-1 el trabajo 801 tiene guia_despacho = 'G-1'.
select pg_temp.como(:'chofer') \g /dev/null
select throws_ok($q$update trabajos set guia_despacho = 'G-9' where id = 'd0000000-0000-0000-0000-000000000801'$q$,
  '42501', 'La guía de despacho solo se puede completar: no se cambia ni se borra un número ya anotado.',
  'el chofer no reemplaza la guía');
select throws_ok($q$update trabajos set guia_despacho = null where id = 'd0000000-0000-0000-0000-000000000801'$q$,
  '42501', 'La guía de despacho solo se puede completar: no se cambia ni se borra un número ya anotado.',
  'ni la borra');
select throws_ok($q$update trabajos set guia_despacho = '' where id = 'd0000000-0000-0000-0000-000000000801'$q$,
  '42501', 'La guía de despacho solo se puede completar: no se cambia ni se borra un número ya anotado.',
  'ni la deja en blanco');
select throws_ok($q$update trabajos set guia_despacho = 'G-10' where id = 'd0000000-0000-0000-0000-000000000801'$q$,
  '42501', 'La guía de despacho solo se puede completar: no se cambia ni se borra un número ya anotado.',
  'ni la cambia por un número que empieza igual');
select lives_ok($q$update trabajos set guia_despacho = 'G-1, G-2' where id = 'd0000000-0000-0000-0000-000000000801'$q$,
  'el chofer sí agrega un número al final');
select lives_ok($q$update trabajos set guia_despacho = 'G-1, G-2', salida = 'encomienda' where id = 'd0000000-0000-0000-0000-000000000801'$q$,
  'y puede dejarla igual mientras cambia otra cosa permitida');
select lives_ok($q$update trabajos set guia_despacho = 'P-1' where id = 'd0000000-0000-0000-0000-000000000802'$q$,
  'una guía vacía se puede llenar');
select pg_temp.como(:'sec') \g /dev/null
select lives_ok($q$update trabajos set guia_despacho = null where id = 'd0000000-0000-0000-0000-000000000801'$q$,
  'gestión sí corrige o borra la guía');
update trabajos set guia_despacho = 'G-1, G-2' where id = 'd0000000-0000-0000-0000-000000000801';

-- ===================== Transporte =====================
select pg_temp.como(:'chofer') \g /dev/null
select lives_ok($q$update trabajos set transporte = 'Starken 998877' where id = 'd0000000-0000-0000-0000-000000000801'$q$,
  'el chofer anota el transporte');
select throws_ok($q$update trabajos set factura = 'F-1' where id = 'd0000000-0000-0000-0000-000000000801'$q$,
  '42501', 'Solo puedes cambiar la salida, la guía de despacho y el transporte de un trabajo.', 'pero no la factura');
select throws_ok($q$update trabajos set guia_retiro = 'R-1' where id = 'd0000000-0000-0000-0000-000000000801'$q$,
  '42501', 'Solo puedes cambiar la salida, la guía de despacho y el transporte de un trabajo.', 'ni la guía de retiro');
select throws_ok($q$update trabajos set clave_idempotencia = gen_random_uuid() where id = 'd0000000-0000-0000-0000-000000000801'$q$,
  '42501', 'Solo puedes cambiar la salida, la guía de despacho y el transporte de un trabajo.', 'ni la clave de idempotencia');
select throws_ok(format($q$update trabajos set transporte = %L where id = 'd0000000-0000-0000-0000-000000000801'$q$, repeat('x', 121)),
  '23514', null, 'transporte de más de 120 caracteres');
select lives_ok($q$select entregar_unidades('[{"linea_id":"b0000000-0000-0000-0000-000000000811","cantidad":1}]', 'G-3', null, '  Chilexpress 55  ')$q$,
  'despachar con transporte');
select is((select row(guia_despacho, transporte)::text from trabajos where id = 'd0000000-0000-0000-0000-000000000801'),
  row('G-1, G-2, G-3', 'Chilexpress 55')::text, 'la entrega agrega el documento y anota el transporte (sin espacios sobrantes)');
select lives_ok($q$select entregar_unidades('[{"linea_id":"b0000000-0000-0000-0000-000000000811","cantidad":1}]', 'G-4', null, '   ')$q$,
  'despachar sin transporte');
select is((select transporte from trabajos where id = 'd0000000-0000-0000-0000-000000000801'), 'Chilexpress 55',
  'sin transporte no se borra el anotado');
select throws_ok(format($q$select entregar_unidades('[{"linea_id":"b0000000-0000-0000-0000-000000000811","cantidad":1}]', 'G-5', null, %L)$q$, repeat('x', 121)),
  'P0001', 'El transporte puede tener hasta 120 caracteres.', 'entregar_unidades valida el largo del transporte');

-- ===================== Idempotencia: crear_trabajo =====================
select pg_temp.como(:'chofer') \g /dev/null
create temp table t1 as select * from crear_trabajo('{"clave":"e0000000-0000-0000-0000-000000000801","cliente_id":"c0000000-0000-0000-0000-000000000801",
  "area":"afilado","entrada":"ruta_propia","lineas":[{"producto":"A","cantidad":2},{"producto":"B","cantidad":3}]}'::jsonb);
create temp table t2 as select * from crear_trabajo('{"clave":"e0000000-0000-0000-0000-000000000801","cliente_id":"c0000000-0000-0000-0000-000000000801",
  "area":"afilado","entrada":"ruta_propia","lineas":[{"producto":"A","cantidad":2},{"producto":"B","cantidad":3}]}'::jsonb);
select is((select id from t2), (select id from t1), 'reintento con la misma clave: devuelve el mismo trabajo');
select is((select numero from t2), (select numero from t1), 'con el mismo número');
select is((select count(*) from trabajos where clave_idempotencia = 'e0000000-0000-0000-0000-000000000801'), 1::bigint,
  'hay un solo trabajo con esa clave');
select is((select count(*) from lineas where trabajo_id = (select id from t1)), 2::bigint, 'y sus 2 líneas, sin duplicar');
select is((select count(*) from movimientos m join lineas l on l.id = m.linea_id where l.trabajo_id = (select id from t1)), 2::bigint,
  'y sus 2 movimientos de recepción, sin duplicar');
select pg_temp.como(:'chofer2') \g /dev/null
select throws_ok($q$select crear_trabajo('{"clave":"e0000000-0000-0000-0000-000000000801","cliente_id":"c0000000-0000-0000-0000-000000000801",
  "area":"afilado","entrada":"ruta_propia","lineas":[{"producto":"Z","cantidad":1}]}'::jsonb)$q$,
  'P0001', 'Esta recepción no se pudo guardar. Cierra el formulario, ábrelo de nuevo e inténtalo otra vez.',
  'la clave de otro usuario no devuelve su trabajo');
select pg_temp.como(:'sec') \g /dev/null
select throws_ok($q$select crear_trabajo('{"clave":"e0000000-0000-0000-0000-000000000801","cliente_id":"c0000000-0000-0000-0000-000000000801",
  "area":"afilado","entrada":"cliente","lineas":[{"producto":"Z","cantidad":1}]}'::jsonb)$q$,
  'P0001', 'Esta recepción no se pudo guardar. Cierra el formulario, ábrelo de nuevo e inténtalo otra vez.',
  'ni siquiera a gestión');
select is((select count(*) from lineas where producto = 'Z'), 0::bigint, 'y no crea nada');
select throws_ok($q$select crear_trabajo('{"clave":"no-es-uuid","cliente_id":"c0000000-0000-0000-0000-000000000801",
  "area":"afilado","entrada":"cliente","lineas":[{"producto":"Z","cantidad":1}]}'::jsonb)$q$,
  'P0001', 'La clave de la solicitud no es válida.', 'clave mal formada');
create temp table t3 as select * from crear_trabajo('{"cliente_id":"c0000000-0000-0000-0000-000000000801",
  "area":"afilado","entrada":"cliente","lineas":[{"producto":"Y","cantidad":1}]}'::jsonb);
create temp table t4 as select * from crear_trabajo('{"cliente_id":"c0000000-0000-0000-0000-000000000801",
  "area":"afilado","entrada":"cliente","lineas":[{"producto":"Y","cantidad":1}]}'::jsonb);
select ok((select id from t3) <> (select id from t4) and (select clave_idempotencia from t3) is null,
  'sin clave cada llamada crea un trabajo nuevo (como antes)');
-- Un fallo no deja la clave tomada: la misma clave sirve en el siguiente intento correcto.
select throws_ok($q$select crear_trabajo('{"clave":"e0000000-0000-0000-0000-000000000802","cliente_id":"c0000000-0000-0000-0000-0000000008ff",
  "area":"afilado","entrada":"cliente","lineas":[{"producto":"X","cantidad":1}]}'::jsonb)$q$,
  'P0001', 'El cliente no existe.', 'un intento fallido');
select lives_ok($q$select crear_trabajo('{"clave":"e0000000-0000-0000-0000-000000000802","cliente_id":"c0000000-0000-0000-0000-000000000801",
  "area":"afilado","entrada":"cliente","lineas":[{"producto":"X","cantidad":1}]}'::jsonb)$q$,
  'el reintento corregido con la misma clave se guarda');

-- ===================== Idempotencia: entregar_unidades =====================
-- Línea 812: 6 listas.
select pg_temp.como(:'chofer') \g /dev/null
select lives_ok($q$select entregar_unidades('[{"linea_id":"b0000000-0000-0000-0000-000000000812","cantidad":2}]', 'R-1',
  'e0000000-0000-0000-0000-000000000811')$q$, 'entrega con clave');
select lives_ok($q$select entregar_unidades('[{"linea_id":"b0000000-0000-0000-0000-000000000812","cantidad":2}]', ' R-1 ',
  'e0000000-0000-0000-0000-000000000811')$q$, 'el reintento con la misma clave responde bien');
select is(array[unidades_en_etapa('b0000000-0000-0000-0000-000000000812', :'listo'),
                unidades_en_etapa('b0000000-0000-0000-0000-000000000812', :'entregado')], array[4, 2],
  'pero no entrega dos veces');
select is((select guia_despacho from trabajos where id = 'd0000000-0000-0000-0000-000000000802'), 'P-1, R-1', 'ni repite el documento');
select throws_ok($q$select entregar_unidades('[{"linea_id":"b0000000-0000-0000-0000-000000000812","cantidad":3}]', 'R-1',
  'e0000000-0000-0000-0000-000000000811')$q$,
  'P0001', 'Esta entrega no se pudo registrar. Cierra el panel, ábrelo de nuevo y revisa lo que ya quedó entregado.',
  'la misma clave con otra cantidad es un error (no se adivina)');
select pg_temp.como(:'chofer2') \g /dev/null
select throws_ok($q$select entregar_unidades('[{"linea_id":"b0000000-0000-0000-0000-000000000812","cantidad":2}]', 'R-1',
  'e0000000-0000-0000-0000-000000000811')$q$,
  'P0001', 'Esta entrega no se pudo registrar. Cierra el panel, ábrelo de nuevo y revisa lo que ya quedó entregado.',
  'la clave de otro usuario es un error');
select is(unidades_en_etapa('b0000000-0000-0000-0000-000000000812', :'entregado'), 2, 'y no entrega nada');
select pg_temp.como(:'chofer') \g /dev/null
select throws_ok($q$select entregar_unidades('[{"linea_id":"b0000000-0000-0000-0000-000000000812","cantidad":9}]', 'R-2',
  'e0000000-0000-0000-0000-000000000812')$q$,
  'P0001', '«Disco» tiene 4 unidades listas; no se pueden entregar 9 (faltan 5).', 'una entrega con clave que falla');
select lives_ok($q$select entregar_unidades('[{"linea_id":"b0000000-0000-0000-0000-000000000812","cantidad":4}]', 'R-2',
  'e0000000-0000-0000-0000-000000000812')$q$, 'no deja la clave tomada: el intento corregido con la misma clave entrega');
select is(unidades_en_etapa('b0000000-0000-0000-0000-000000000812', :'entregado'), 6, 'quedaron las 6 entregadas');
select is((select count(*) from entregas_registradas), 0::bigint, 'nadie lee la tabla de claves directamente (RLS sin políticas)');

select * from finish();
rollback;
