-- Pruebas de editar_trabajo (0011): editar un trabajo mientras sigue en Recepción.
-- Compatible con pgTAP y con el shim local (scripts/sql-local/pgtap_shim.sql).
\set ON_ERROR_STOP 1
\pset tuples_only on
\pset format unaligned

begin;
select plan(22);

select id as recibido from etapas where area = 'afilado' and nombre = 'Recibido' \gset
select id as taller from etapas where area = 'afilado' and nombre = 'En taller' \gset

insert into auth.users (id) values
  ('a0000000-0000-0000-0000-0000000000e1'), ('a0000000-0000-0000-0000-0000000000e2'),
  ('a0000000-0000-0000-0000-0000000000e3');
insert into perfiles (usuario_id, nombre, rol) values
  ('a0000000-0000-0000-0000-0000000000e1', 'Secretaria', 'secretaria'),
  ('a0000000-0000-0000-0000-0000000000e2', 'Chofer', 'chofer'),
  ('a0000000-0000-0000-0000-0000000000e3', 'Afilador', 'operario_afilado');
insert into clientes (id, nombre, rut) values
  ('c0000000-0000-0000-0000-0000000000e1', 'Cliente uno', '11-1'),
  ('c0000000-0000-0000-0000-0000000000e2', 'Cliente dos', '22-2');

set local role authenticated;
-- El chofer recibe el trabajo (dos líneas).
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000e2"}', true) \g /dev/null
select id as tr from crear_trabajo('{"cliente_id":"c0000000-0000-0000-0000-0000000000e1","area":"afilado","entrada":"ruta_propia",
  "lineas":[{"producto":"Cuchillo","cantidad":10,"nota":"20 cm"},{"producto":"Tijera","cantidad":3}]}'::jsonb) \gset
select id as l1 from lineas where trabajo_id = :'tr' and producto = 'Cuchillo' \gset
select id as l2 from lineas where trabajo_id = :'tr' and producto = 'Tijera' \gset

-- ===================== Permisos =====================
select throws_ok(format($q$select editar_trabajo(%L, '{"cliente_id":"c0000000-0000-0000-0000-0000000000e2","lineas":[{"producto":"x","cantidad":1}]}')$q$, :'tr'),
  '42501', 'No tienes permiso para editar trabajos.', 'el chofer no edita');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000e3"}', true) \g /dev/null
select throws_ok(format($q$select editar_trabajo(%L, '{"cliente_id":"c0000000-0000-0000-0000-0000000000e2","lineas":[{"producto":"x","cantidad":1}]}')$q$, :'tr'),
  '42501', 'No tienes permiso para editar trabajos.', 'el operario no edita');

-- ===================== Edición (secretaria) =====================
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000e1"}', true) \g /dev/null

select is((select cliente_id from editar_trabajo(:'tr', format(
    '{"cliente_id":"c0000000-0000-0000-0000-0000000000e2","urgente":true,"guia_retiro":" G-9 ","notas":"ojo",
      "lineas":[{"id":"%s","producto":" Cuchillo grande ","cantidad":7,"nota":"Ø14 blanco"},{"producto":"Formón","cantidad":2}]}', :'l1')::jsonb)),
  'c0000000-0000-0000-0000-0000000000e2'::uuid, 'cambia el cliente');
select is((select row(urgente, guia_retiro, notas, area)::text from trabajos where id = :'tr'),
  row(true, 'G-9', 'ojo', 'afilado'::area)::text, 'cambia urgente, guía y notas; el área sigue igual');
select is((select count(*) from lineas where trabajo_id = :'tr'), 2::bigint, 'queda una línea editada y una nueva');
select is((select count(*) from lineas where id = :'l2'), 0::bigint, 'la línea quitada se borra');
select is((select count(*) from movimientos where linea_id = :'l2'), 0::bigint, 'con su recepción inicial');
select is((select row(producto, cantidad, nota)::text from lineas where id = :'l1'),
  row('Cuchillo grande', 7, 'Ø14 blanco')::text, 'cambia producto, cantidad y detalle (recortados)');
select is((select row(count(*), sum(cantidad), min(usuario_id::text))::text from movimientos where linea_id = :'l1'),
  row(1::bigint, 7::bigint, 'a0000000-0000-0000-0000-0000000000e2')::text,
  'la recepción inicial queda con la nueva cantidad y conserva quién la recibió');
select is((select row(m.cantidad, m.etapa_destino_id, m.usuario_id)::text from movimientos m join lineas l on l.id = m.linea_id
            where l.trabajo_id = :'tr' and l.producto = 'Formón'),
  row(2, :'recibido'::uuid, 'a0000000-0000-0000-0000-0000000000e1'::uuid)::text,
  'la línea nueva se recibe en la primera etapa a nombre de quien edita');
select is((select unidades_en_etapa(:'l1', :'recibido')), 7, 'las unidades en Recibido cuadran');

-- Subir la cantidad también funciona.
select lives_ok(format($q$select editar_trabajo(%L, '{"cliente_id":"c0000000-0000-0000-0000-0000000000e2",
    "lineas":[{"id":"%s","producto":"Cuchillo grande","cantidad":40}]}')$q$, :'tr', :'l1'), 'se puede subir la cantidad');
select is((select row(l.cantidad, (select sum(cantidad) from movimientos where linea_id = l.id))::text from lineas l where id = :'l1'),
  row(40, 40::bigint)::text, 'línea y recepción con la cantidad nueva');
select is((select row(urgente, guia_retiro, notas)::text from trabajos where id = :'tr'),
  row(false, null::text, null::text)::text, 'sin urgente, guía ni notas se limpian');

-- ===================== Validaciones =====================
select throws_ok(format($q$select editar_trabajo(%L, '{"cliente_id":"c0000000-0000-0000-0000-0000000000e2","lineas":[]}')$q$, :'tr'),
  'P0001', 'Agrega al menos una línea.', 'sin líneas');
select throws_ok(format($q$select editar_trabajo(%L, '{"cliente_id":"c0000000-0000-0000-0000-0000000000aa","lineas":[{"producto":"x","cantidad":1}]}')$q$, :'tr'),
  'P0001', 'El cliente no existe.', 'cliente inexistente');
select throws_ok(format($q$select editar_trabajo(%L, '{"cliente_id":"c0000000-0000-0000-0000-0000000000e2","lineas":[{"producto":"x","cantidad":0}]}')$q$, :'tr'),
  'P0001', 'La cantidad de la línea 1 debe ser un número entero mayor que cero.', 'cantidad cero');
select throws_ok(format($q$select editar_trabajo(%L, '{"cliente_id":"c0000000-0000-0000-0000-0000000000e2","lineas":[{"id":"%s","producto":"x","cantidad":1}]}')$q$, :'tr', :'l2'),
  'P0001', 'La línea 1 no es de este trabajo.', 'una línea ajena (o ya borrada) se rechaza');
select throws_ok(format($q$select editar_trabajo(%L, '{"cliente_id":"c0000000-0000-0000-0000-0000000000e2","lineas":[{"id":"%s","producto":"x","cantidad":1},{"id":"%s","producto":"y","cantidad":1}]}')$q$, :'tr', :'l1', :'l1'),
  'P0001', 'La línea 2 está repetida.', 'línea repetida');
select is((select cantidad from lineas where id = :'l1'), 40, 'un error no deja nada a medias');

-- ===================== Ya en taller =====================
select lives_ok(format($q$select mover_unidades(%L, 1, %L, %L)$q$, :'l1', :'recibido', :'taller'), 'una pieza pasa al taller');
select throws_ok(format($q$select editar_trabajo(%L, '{"cliente_id":"c0000000-0000-0000-0000-0000000000e1","lineas":[{"id":"%s","producto":"x","cantidad":40}]}')$q$, :'tr', :'l1'),
  'P0001', 'Este trabajo ya tiene piezas en el taller: ya no se puede editar desde Recepción.', 'ya no se edita');

select * from finish();
rollback;
