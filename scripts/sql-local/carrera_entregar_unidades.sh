#!/usr/bin/env bash
# Carrera real de entregas: N choferes (procesos y conexiones psql distintas) entregan a la vez las
# mismas unidades listas de dos líneas del mismo trabajo, la mitad con las líneas en un orden y la
# otra mitad en el inverso, cada uno con su N° de documento. Cada transacción queda abierta un rato
# para forzar el solapamiento. Debe ganar exactamente lo que alcanza, sin deadlocks, sin entregar de
# más y sin perder números en la guía de despacho.
# Requiere una base ya migrada (ver correr_pruebas.sh). Uso: DB=trazabilidad_pruebas carrera_entregar_unidades.sh
set -euo pipefail
DB="${DB:-trazabilidad_pruebas}"
N="${N:-20}"
PSQL=(psql -X -q -At -v ON_ERROR_STOP=1 -d "$DB")
LA=b0000000-0000-0000-0000-0000000007e1
LB=b0000000-0000-0000-0000-0000000007e2
TR=d0000000-0000-0000-0000-0000000007e1
CL=c0000000-0000-0000-0000-0000000007e1
CH=a0000000-0000-0000-0000-0000000007e1
SALIDA="$(mktemp -d)"
trap 'rm -rf "$SALIDA"' EXIT

limpiar() {
  "${PSQL[@]}" <<SQL
delete from movimientos where linea_id in ('$LA', '$LB');
delete from lineas where id in ('$LA', '$LB');
delete from trabajos where id = '$TR';
delete from clientes where id = '$CL';
delete from perfiles where usuario_id = '$CH';
delete from auth.users where id = '$CH';
SQL
}
limpiar
"${PSQL[@]}" <<SQL
insert into auth.users (id) values ('$CH');
insert into perfiles values ('$CH', 'Chofer carrera', 'chofer');
insert into clientes (id, nombre, rut) values ('$CL', 'Cliente carrera entrega', '1-9');
insert into trabajos (id, cliente_id, area, entrada, salida) values ('$TR', '$CL', 'afilado', 'ruta_propia', 'ruta_propia');
insert into lineas (id, trabajo_id, producto, cantidad) values ('$LA', '$TR', 'Cuchillo', 6), ('$LB', '$TR', 'Tijera', 6);
insert into movimientos (linea_id, cantidad, etapa_origen_id, etapa_destino_id, usuario_id)
  select l, 6, null, e.id, '$CH' from unnest(array['$LA', '$LB']::uuid[]) l, etapas e
   where e.area = 'afilado' and e.nombre = 'Recibido';
insert into movimientos (linea_id, cantidad, etapa_origen_id, etapa_destino_id, usuario_id)
  select l, 6, r.id, t.id, '$CH' from unnest(array['$LA', '$LB']::uuid[]) l, etapas r, etapas t
   where r.area = 'afilado' and r.nombre = 'Recibido' and t.area = 'afilado' and t.nombre = 'Listo';
SQL

for i in $(seq 1 "$N"); do
  if (( i % 2 )); then ENTREGAS="[{\"linea_id\":\"$LA\",\"cantidad\":2},{\"linea_id\":\"$LB\",\"cantidad\":2}]"
  else ENTREGAS="[{\"linea_id\":\"$LB\",\"cantidad\":2},{\"linea_id\":\"$LA\",\"cantidad\":2}]"; fi
  (
    if "${PSQL[@]}" >/dev/null 2>"$SALIDA/err.$i" <<SQL
set role authenticated;
set request.jwt.claims = '{"sub":"$CH"}';
begin;
select pg_sleep(0.05);
select entregar_unidades('$ENTREGAS', 'G$i');
select pg_sleep(0.2);
commit;
SQL
    then echo "ok G$i" >"$SALIDA/res.$i"; else echo falla >"$SALIDA/res.$i"; fi
  ) &
done
wait

OK=$(cat "$SALIDA"/res.* | grep -c '^ok' || true)
FALLAS=$(cat "$SALIDA"/res.* | grep -c '^falla$' || true)
MSG_OK=$(cat "$SALIDA"/err.* | grep -c 'tiene 0 unidades listas; no se pueden entregar 2 (faltan 2)' || true)
DEADLOCKS=$(cat "$SALIDA"/err.* | grep -ci 'deadlock' || true)
DIST=$("${PSQL[@]}" <<SQL
select string_agg(l.producto || ':' || e.nombre || '=' || unidades_en_etapa(l.id, e.id), ', ' order by l.producto, e.orden)
  from lineas l, etapas e where l.id in ('$LA', '$LB') and e.area = 'afilado' and e.nombre in ('Listo', 'Entregado');
SQL
)
GUIA=$("${PSQL[@]}" -c "select guia_despacho from trabajos where id = '$TR'")
GANADORES=$(cat "$SALIDA"/res.* | sed -n 's/^ok //p' | sort | paste -sd, -)
GUIA_ORDENADA=$(tr -d ' ' <<<"$GUIA" | tr ',' '\n' | sort | paste -sd, -)
limpiar

echo "sesiones=$N exitosas=$OK fallidas=$FALLAS fallas_con_mensaje_claro=$MSG_OK deadlocks=$DEADLOCKS"
echo "distribución final: $DIST"
echo "guía de despacho: $GUIA (ganadores: $GANADORES)"
if [[ "$OK" -eq 3 && "$FALLAS" -eq $((N - 3)) && "$MSG_OK" -eq $((N - 3)) && "$DEADLOCKS" -eq 0 \
      && "$DIST" == "Cuchillo:Listo=0, Cuchillo:Entregado=6, Tijera:Listo=0, Tijera:Entregado=6" \
      && "$GUIA_ORDENADA" == "$GANADORES" ]]; then
  echo "carrera de entregas OK: nunca se entregó más de lo listo, sin deadlocks y sin perder documentos"
else
  echo "carrera de entregas FALLÓ" >&2
  head -n 3 "$SALIDA"/err.* >&2 || true
  exit 1
fi
