#!/usr/bin/env bash
# Carrera real: N sesiones psql en paralelo (procesos y conexiones distintas) intentan mover
# unidades de la misma línea a la vez. Cada una mantiene su transacción abierta un rato para
# forzar el solapamiento. Debe ganar exactamente lo que alcanza y ninguna etapa queda negativa.
# Requiere una base ya migrada (ver correr_pruebas.sh). Uso: DB=trazabilidad_pruebas carrera_mover_unidades.sh
set -euo pipefail
DB="${DB:-trazabilidad_pruebas}"
N="${N:-20}"
PSQL=(psql -X -q -At -v ON_ERROR_STOP=1 -d "$DB")
LINEA=b0000000-0000-0000-0000-0000000000e1
OP=a0000000-0000-0000-0000-0000000000e1
SALIDA="$(mktemp -d)"
trap 'rm -rf "$SALIDA"' EXIT

limpiar() {
  "${PSQL[@]}" <<SQL
delete from movimientos where linea_id = '$LINEA';
delete from lineas where id = '$LINEA';
delete from trabajos where cliente_id = 'c0000000-0000-0000-0000-0000000000e1';
delete from clientes where id = 'c0000000-0000-0000-0000-0000000000e1';
delete from perfiles where usuario_id = '$OP';
delete from auth.users where id = '$OP';
SQL
}
limpiar
"${PSQL[@]}" <<SQL
insert into auth.users (id) values ('$OP');
insert into perfiles values ('$OP', 'Operario carrera', 'operario_afilado');
insert into clientes (id, nombre, rut) values ('c0000000-0000-0000-0000-0000000000e1', 'Cliente carrera', '1-9');
with t as (insert into trabajos (cliente_id, area, entrada, salida)
           values ('c0000000-0000-0000-0000-0000000000e1', 'afilado', 'cliente', 'cliente') returning id)
insert into lineas (id, trabajo_id, producto, cantidad) select '$LINEA', id, 'Cuchillo', 6 from t;
insert into movimientos (linea_id, cantidad, etapa_origen_id, etapa_destino_id, usuario_id)
  select '$LINEA', 6, null, id, '$OP' from etapas where area = 'afilado' and nombre = 'Recibido';
insert into movimientos (linea_id, cantidad, etapa_origen_id, etapa_destino_id, usuario_id)
  select '$LINEA', 6, r.id, t.id, '$OP' from etapas r, etapas t
   where r.area = 'afilado' and r.nombre = 'Recibido' and t.area = 'afilado' and t.nombre = 'En taller';
SQL

for i in $(seq 1 "$N"); do
  (
    if "${PSQL[@]}" >/dev/null 2>"$SALIDA/err.$i" <<SQL
set role authenticated;
set request.jwt.claims = '{"sub":"$OP"}';
begin;
select pg_sleep(0.05);
select mover_unidades('$LINEA', 2,
  (select id from etapas where area = 'afilado' and nombre = 'En taller'),
  (select id from etapas where area = 'afilado' and nombre = 'Listo'));
select pg_sleep(0.2);
commit;
SQL
    then echo ok >"$SALIDA/res.$i"; else echo falla >"$SALIDA/res.$i"; fi
  ) &
done
wait

OK=$(cat "$SALIDA"/res.* | grep -c '^ok$' || true)
FALLAS=$(cat "$SALIDA"/res.* | grep -c '^falla$' || true)
MSG_OK=$(cat "$SALIDA"/err.* | grep -c 'no se pueden mover 2' || true)
DIST=$("${PSQL[@]}" <<SQL
select string_agg(e.nombre || '=' || unidades_en_etapa('$LINEA', e.id), ', ' order by e.orden)
  from etapas e where e.area = 'afilado';
SQL
)
MIN=$("${PSQL[@]}" -c "select min(unidades_en_etapa('$LINEA', id)) from etapas where area = 'afilado'")
limpiar

echo "sesiones=$N exitosas=$OK fallidas=$FALLAS fallas_con_mensaje_claro=$MSG_OK"
echo "distribución final: $DIST"
if [[ "$OK" -eq 3 && "$FALLAS" -eq $((N - 3)) && "$MSG_OK" -eq $((N - 3)) && "$MIN" -ge 0 \
      && "$DIST" == *"En taller=0"* && "$DIST" == *"Listo=6"* ]]; then
  echo "carrera OK: nunca se asignaron más unidades que el total de la línea"
else
  echo "carrera FALLÓ" >&2
  head -n 3 "$SALIDA"/err.* >&2 || true
  exit 1
fi
