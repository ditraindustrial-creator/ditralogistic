-- Trazabilidad: un cliente puede estar en varios recorridos (spec §5.2, "Recorridos múltiples y
-- visitas a pedido"). La hoja real tiene 10 recorridos (lunes a viernes, dos choferes titulares) y
-- muchos clientes salen en 2 o 3 días. Reemplaza clientes.recorrido_id (un solo recorrido y día).

-- Chofer titular del recorrido (nombre para mostrar, p. ej. "Rodrigo Lagos"); opcional. La Hoja de
-- ruta elige por defecto el recorrido del día cuyo chofer coincide con el nombre del perfil.
alter table recorridos add column chofer text;
alter table recorridos add constraint recorridos_chofer_largo check (chofer is null or char_length(chofer) <= 120);

-- fija = true: se visita siempre ese día (si no hay nada que entregar, sale en "Pasar a retirar").
-- fija = false ("a pedido", los nombres entre paréntesis de la hoja): sale ese día solo si tiene algo
-- listo para entregar por ruta propia o una visita solicitada o confirmada "sí".
-- orden: orden sugerido de visita dentro del recorrido (el chofer decide el orden real cada día).
create table cliente_recorridos (
  cliente_id uuid not null references clientes(id) on delete cascade,
  recorrido_id uuid not null references recorridos(id) on delete cascade,
  fija boolean not null default true,
  orden integer not null default 0,
  primary key (cliente_id, recorrido_id),
  constraint cliente_recorridos_orden_positivo check (orden >= 0)
);
create index on cliente_recorridos (recorrido_id);

-- Las asignaciones que ya existían pasan como fijas (antes cada cliente se visitaba en su día).
insert into cliente_recorridos (cliente_id, recorrido_id, fija, orden)
  select id, recorrido_id, true, 0 from clientes where recorrido_id is not null;

alter table clientes drop column recorrido_id;

-- RLS: todos los usuarios con perfil leen (la ruta y "Qué hay listo" las usan); solo gestión
-- (administración, secretaría, jefe de taller) asigna, cambia o quita. Chofer y operarios solo leen.
alter table cliente_recorridos enable row level security;
create policy cliente_recorridos_ver on cliente_recorridos for select to authenticated
  using (rol_actual() is not null);
create policy cliente_recorridos_gestion on cliente_recorridos for all to authenticated
  using (es_gestion()) with check (es_gestion());
