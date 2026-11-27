-- Numeración separada por área (pedido del dueño, 2026-11-27).
-- Cada área lleva su propio correlativo: Afilado A-001, A-002…; Encuadernación E-001, E-002…
-- La app muestra el código (letra del área + numero_area con tres cifras). trabajos.numero (identity
-- global) se queda como número interno y no se muestra.
--
-- Trabajos existentes: se numeran por área en el orden en que se recibieron (recibido_en, y numero
-- para desempatar), así el más antiguo de cada área queda con el 1.
--
-- Trabajos nuevos: un trigger before insert toma el siguiente número del contador de su área
-- (contadores_area). El update ... returning bloquea la fila del contador, así que dos recepciones
-- simultáneas de la misma área nunca reciben el mismo número. El número no se puede cambiar después.

alter table trabajos add column numero_area integer;

with orden as (
  select id, row_number() over (partition by area order by recibido_en, numero) as n
  from trabajos
)
update trabajos t set numero_area = orden.n from orden where orden.id = t.id;

create table contadores_area (
  area area primary key,
  ultimo integer not null default 0
);
alter table contadores_area enable row level security;
-- Sin políticas: solo el trigger (security definer) lo lee y lo cambia.

insert into contadores_area (area, ultimo)
select a.area, coalesce((select max(t.numero_area) from trabajos t where t.area = a.area), 0)
from (values ('afilado'::area), ('encuadernacion'::area)) as a(area);

create function trabajos_numerar() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update contadores_area set ultimo = ultimo + 1 where area = new.area
    returning ultimo into new.numero_area;
  if new.numero_area is null then
    insert into contadores_area (area, ultimo) values (new.area, 1)
      on conflict (area) do update set ultimo = contadores_area.ultimo + 1
      returning ultimo into new.numero_area;
  end if;
  return new;
end $$;
revoke execute on function trabajos_numerar() from public;
create trigger trabajos_numerar before insert on trabajos
  for each row execute function trabajos_numerar();

create function trabajos_numero_fijo() returns trigger
  language plpgsql set search_path = public, pg_temp as $$
begin
  if new.numero_area is distinct from old.numero_area then
    raise exception 'El número de un trabajo no se puede cambiar.' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke execute on function trabajos_numero_fijo() from public;
create trigger trabajos_numero_fijo before update on trabajos
  for each row execute function trabajos_numero_fijo();

alter table trabajos alter column numero_area set not null;
alter table trabajos add constraint trabajos_numero_area_unico unique (area, numero_area);
