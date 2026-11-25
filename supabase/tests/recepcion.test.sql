-- Pruebas de crear_trabajo, recepción solo a la primera etapa y guardas de líneas/trabajos (0005).
-- Compatible con pgTAP y con el shim local (scripts/sql-local/pgtap_shim.sql).
\set ON_ERROR_STOP 1
\pset tuples_only on
\pset format unaligned

begin;
select plan(36);

select id as recibido from etapas where area = 'afilado' and nombre = 'Recibido' \gset
select id as taller from etapas where area = 'afilado' and nombre = 'En taller' \gset
select id as listo from etapas where area = 'afilado' and nombre = 'Listo' \gset
select id as enc_recibido from etapas where area = 'encuadernacion' and nombre = 'Recibido' \gset

insert into auth.users (id) values
  ('a0000000-0000-0000-0000-0000000000f1'), ('a0000000-0000-0000-0000-0000000000f2'),
  ('a0000000-0000-0000-0000-0000000000f3');
insert into perfiles (usuario_id, nombre, rol) values
  ('a0000000-0000-0000-0000-0000000000f1', 'Secretaria', 'secretaria'),
  ('a0000000-0000-0000-0000-0000000000f2', 'Chofer', 'chofer'),
  ('a0000000-0000-0000-0000-0000000000f3', 'Afilador', 'operario_afilado');
insert into clientes (id, nombre, rut) values ('c0000000-0000-0000-0000-0000000000f1', 'Cliente recepción', '1-9');

-- ===================== crear_trabajo =====================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000f1"}', true) \g /dev/null

create temp table creado as
  select * from crear_trabajo('{"cliente_id":"c0000000-0000-0000-0000-0000000000f1","area":"afilado","entrada":"cliente",
    "urgente":true,"guia_retiro":" G-55 ","lineas":[{"producto":" Cuchillo 20 cm ","cantidad":12},{"producto":"Tijera","cantidad":3}]}'::jsonb);
grant all on creado to authenticated;

select is((select row(area, entrada, salida, urgente, guia_retiro, cliente_id)::text from creado),
  row('afilado'::area, 'cliente'::modalidad, 'cliente'::modalidad, true, 'G-55', 'c0000000-0000-0000-0000-0000000000f1'::uuid)::text,
  'crea el trabajo: salida por defecto = entrada, textos recortados');
select ok((select numero from creado) >= 1, 'el trabajo recibe un número correlativo');
select is((select count(*) from lineas where trabajo_id = (select id from creado)), 2::bigint, 'crea las dos líneas');
select is((select producto from lineas where trabajo_id = (select id from creado) order by producto limit 1), 'Cuchillo 20 cm',
  'el producto se guarda sin espacios sobrantes');
select is((select count(*) from movimientos m join lineas l on l.id = m.linea_id
            where l.trabajo_id = (select id from creado)
              and m.etapa_origen_id is null and m.etapa_destino_id = :'recibido'
              and m.usuario_id = 'a0000000-0000-0000-0000-0000000000f1' and m.cantidad = l.cantidad), 2::bigint,
  'cada línea tiene su movimiento inicial (origen NULL) a Recibido, con la cantidad completa y el usuario de la sesión');

select is((select numero from crear_trabajo(format('{"cliente_id":"c0000000-0000-0000-0000-0000000000f1","area":"encuadernacion",
    "entrada":"encomienda","salida":"ruta_propia","lineas":[{"producto":"Libro","cantidad":1,"nota":"70 cm"}]}')::jsonb))
  - (select numero from creado), 1::bigint, 'el siguiente trabajo tiene el número siguiente');
select is((select m.etapa_destino_id from movimientos m join lineas l on l.id = m.linea_id where l.producto = 'Libro'),
  :'enc_recibido'::uuid, 'encuadernación recibe en su propia primera etapa');

-- Validaciones: mensajes en español, sin dejar nada a medias.
select throws_ok($q$select crear_trabajo('{"area":"afilado","entrada":"cliente","lineas":[{"producto":"x","cantidad":1}]}')$q$,
  'P0001', 'Elige el cliente.', 'sin cliente');
select throws_ok($q$select crear_trabajo('{"cliente_id":"c0000000-0000-0000-0000-0000000000aa","area":"afilado","entrada":"cliente","lineas":[{"producto":"x","cantidad":1}]}')$q$,
  'P0001', 'El cliente no existe.', 'cliente inexistente');
select throws_ok($q$select crear_trabajo('{"cliente_id":"c0000000-0000-0000-0000-0000000000f1","area":"herreria","entrada":"cliente","lineas":[{"producto":"x","cantidad":1}]}')$q$,
  'P0001', 'Elige el área (afilado o encuadernación).', 'área inválida');
select throws_ok($q$select crear_trabajo('{"cliente_id":"c0000000-0000-0000-0000-0000000000f1","area":"afilado","entrada":"volando","lineas":[{"producto":"x","cantidad":1}]}')$q$,
  'P0001', 'Elige cómo llegó el trabajo.', 'modalidad inválida');
select throws_ok($q$select crear_trabajo('{"cliente_id":"c0000000-0000-0000-0000-0000000000f1","area":"afilado","entrada":"cliente","lineas":[]}')$q$,
  'P0001', 'Agrega al menos una línea.', 'sin líneas');
select throws_ok($q$select crear_trabajo('{"cliente_id":"c0000000-0000-0000-0000-0000000000f1","area":"afilado","entrada":"cliente","lineas":[{"producto":"x","cantidad":0}]}')$q$,
  'P0001', 'La cantidad de la línea 1 debe ser un número entero mayor que cero.', 'cantidad 0');
select throws_ok($q$select crear_trabajo('{"cliente_id":"c0000000-0000-0000-0000-0000000000f1","area":"afilado","entrada":"cliente","lineas":[{"producto":"x","cantidad":1.5}]}')$q$,
  'P0001', 'La cantidad de la línea 1 debe ser un número entero mayor que cero.', 'cantidad decimal');
select throws_ok($q$select crear_trabajo('{"cliente_id":"c0000000-0000-0000-0000-0000000000f1","area":"afilado","entrada":"cliente","lineas":[{"producto":"x","cantidad":"3"}]}')$q$,
  'P0001', 'La cantidad de la línea 1 debe ser un número entero mayor que cero.', 'cantidad como texto');
select throws_ok($q$select crear_trabajo('{"cliente_id":"c0000000-0000-0000-0000-0000000000f1","area":"afilado","entrada":"cliente","lineas":[{"producto":"x","cantidad":99999999999}]}')$q$,
  'P0001', 'La cantidad de la línea 1 debe ser un número entero mayor que cero.', 'cantidad fuera de rango');
select throws_ok($q$select crear_trabajo('{"cliente_id":"c0000000-0000-0000-0000-0000000000f1","area":"afilado","entrada":"cliente","lineas":[{"producto":"ok","cantidad":1},{"producto":"   ","cantidad":2}]}')$q$,
  'P0001', 'La línea 2 necesita un producto.', 'producto vacío en la segunda línea');
select is((select count(*) from trabajos), 2::bigint, 'las validaciones fallidas no dejaron trabajos');

-- Atomicidad: un fallo a mitad de camino (tercera línea) deshace el trabajo y las líneas ya insertadas.
reset role;
create function pg_temp.falla_boom() returns trigger language plpgsql as $$
begin
  if new.producto = 'BOOM' then raise exception 'fallo simulado' using errcode = 'XX000'; end if;
  return new;
end $$;
create trigger falla_boom before insert on lineas for each row execute function pg_temp.falla_boom();
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000f1"}', true) \g /dev/null
select throws_ok($q$select crear_trabajo('{"cliente_id":"c0000000-0000-0000-0000-0000000000f1","area":"afilado","entrada":"cliente","lineas":[{"producto":"A","cantidad":1},{"producto":"B","cantidad":1},{"producto":"BOOM","cantidad":1}]}')$q$,
  'XX000', 'fallo simulado', 'un fallo en la tercera línea aborta la función');
select is((select count(*) from trabajos), 2::bigint, 'atomicidad: no queda un trabajo a medias');
select is((select count(*) from lineas where producto in ('A', 'B', 'BOOM')), 0::bigint, 'atomicidad: no quedan las líneas anteriores');
reset role;
drop trigger falla_boom on lineas;

-- Permisos
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000f2"}', true) \g /dev/null
select lives_ok($q$select crear_trabajo('{"cliente_id":"c0000000-0000-0000-0000-0000000000f1","area":"afilado","entrada":"ruta_propia","lineas":[{"producto":"Retiro","cantidad":2}]}')$q$,
  'el chofer crea un retiro');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000f3"}', true) \g /dev/null
select throws_ok($q$select crear_trabajo('{"cliente_id":"c0000000-0000-0000-0000-0000000000f1","area":"afilado","entrada":"cliente","lineas":[{"producto":"x","cantidad":1}]}')$q$,
  '42501', 'No tienes permiso para recibir trabajos.', 'un operario no recibe trabajos');
select set_config('request.jwt.claims', '', true) \g /dev/null
select throws_ok($q$select crear_trabajo('{"cliente_id":"c0000000-0000-0000-0000-0000000000f1","area":"afilado","entrada":"cliente","lineas":[{"producto":"x","cantidad":1}]}')$q$,
  '42501', 'Debes iniciar sesión para recibir trabajos.', 'sin sesión no se recibe');
reset role;

-- ===================== Recepción solo a la primera etapa =====================
create temp table t2 as select
  gen_random_uuid() as trabajo, gen_random_uuid() as linea;
insert into trabajos (id, cliente_id, area, entrada, salida)
  select trabajo, 'c0000000-0000-0000-0000-0000000000f1', 'afilado', 'cliente', 'cliente' from t2;
insert into lineas (id, trabajo_id, producto, cantidad) select linea, trabajo, 'Hacha', 10 from t2;
select linea as l2, trabajo as tr2 from t2 \gset

select throws_ok(format($q$insert into movimientos (linea_id, cantidad, etapa_origen_id, etapa_destino_id, usuario_id)
    values (%L, 4, null, %L, 'a0000000-0000-0000-0000-0000000000f1')$q$, :'l2', :'taller'),
  'P0001', 'La recepción solo puede ir a la primera etapa del área.', 'recibir directo en una etapa intermedia falla');
select throws_ok(format($q$insert into movimientos (linea_id, cantidad, etapa_origen_id, etapa_destino_id, usuario_id)
    values (%L, 4, null, %L, 'a0000000-0000-0000-0000-0000000000f1')$q$, :'l2', :'listo'),
  'P0001', 'La recepción solo puede ir a la primera etapa del área.', 'recibir directo en Listo falla');
select lives_ok(format($q$insert into movimientos (linea_id, cantidad, etapa_origen_id, etapa_destino_id, usuario_id)
    values (%L, 4, null, %L, 'a0000000-0000-0000-0000-0000000000f1')$q$, :'l2', :'recibido'),
  'recibir en la primera etapa funciona (recepción parcial)');

-- ===================== Guardas de líneas =====================
select throws_ok(format('update lineas set cantidad = 3 where id = %L', :'l2'),
  'P0001', 'La línea ya recibió 4 unidades; la cantidad no puede ser menor.', 'no se baja la cantidad por debajo de lo recibido');
select lives_ok(format('update lineas set cantidad = 4 where id = %L', :'l2'), 'se puede bajar hasta lo recibido');
select lives_ok(format('update lineas set cantidad = 20 where id = %L', :'l2'), 'se puede subir la cantidad');
select throws_ok(format('update lineas set trabajo_id = (select id from trabajos where id <> %L limit 1) where id = %L', :'tr2', :'l2'),
  'P0001', 'No se puede cambiar el trabajo de una línea que ya tiene movimientos.', 'no se cambia el trabajo de una línea con movimientos');
select lives_ok(format($q$update lineas set producto = 'Hacha grande', nota = '70 cm' where id = %L$q$, :'l2'),
  'otros campos de la línea se pueden editar');

-- ===================== Guardas de trabajos =====================
select throws_ok(format($q$update trabajos set area = 'encuadernacion' where id = %L$q$, :'tr2'),
  'P0001', 'No se puede cambiar el área de un trabajo que ya tiene movimientos.', 'no se cambia el área con movimientos');
select lives_ok(format('update trabajos set urgente = true where id = %L', :'tr2'), 'otros campos del trabajo se pueden editar');
insert into trabajos (id, cliente_id, area, entrada, salida)
  values ('d0000000-0000-0000-0000-0000000000f9', 'c0000000-0000-0000-0000-0000000000f1', 'afilado', 'cliente', 'cliente');
insert into lineas (trabajo_id, producto, cantidad) values ('d0000000-0000-0000-0000-0000000000f9', 'Sin mover', 5);
select lives_ok($q$update trabajos set area = 'encuadernacion' where id = 'd0000000-0000-0000-0000-0000000000f9'$q$,
  'sin movimientos el área sí se puede cambiar');
select lives_ok($q$update lineas set cantidad = 1 where trabajo_id = 'd0000000-0000-0000-0000-0000000000f9'$q$,
  'sin movimientos la cantidad se puede bajar (mínimo 1 por la restricción de la tabla)');

select * from finish();
rollback;
