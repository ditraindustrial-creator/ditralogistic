#!/usr/bin/env bash
# Carrera de reintentos: N sesiones psql (procesos y conexiones distintas) del mismo chofer llaman a
# la vez a crear_trabajo con la MISMA clave de idempotencia, y luego N a entregar_unidades con la
# misma clave. Cada transacción queda abierta un rato para forzar el solapamiento. Debe quedar un
# solo trabajo (todas las llamadas devuelven el mismo) y una sola entrega, sin errores.
# Requiere una base ya migrada (ver correr_pruebas.sh). Uso: DB=trazabilidad_pruebas carrera_clave_idempotencia.sh
set -euo pipefail
DB="${DB:-trazabilidad_pruebas}"
N="${N:-12}"
PSQL=(psql -X -q -At -v ON_ERROR_STOP=1 -d "$DB")
CH=a0000000-0000-0000-0000-0000000008e1
CL=c0000000-0000-0000-0000-0000000008e1
CLAVE_T=e0000000-0000-0000-0000-0000000008e1
CLAVE_E=e0000000-0000-0000-0000-0000000008e2
SALIDA="$(mktemp -d)"
trap 'rm -rf "$SALIDA"' EXIT

limpiar() {
  "${PSQL[@]}" <<SQL
delete from movimientos where linea_id in (select l.id from lineas l join trabajos t on t.id = l.trabajo_id where t.cliente_id = '$CL');
delete from lineas where trabajo_id in (select id from trabajos where cliente_id = '$CL');
delete from trabajos where cliente_id = '$CL';
delete from entregas_registradas where clave in ('$CLAVE_T', '$CLAVE_E');
delete from clientes where id = '$CL';
delete from perfiles where usuario_id = '$CH';
delete from auth.users where id = '$CH';
SQL
}
limpiar
"${PSQL[@]}" <<SQL
insert into auth.users (id) values ('$CH');
insert into perfiles values ('$CH', 'Chofer carrera clave', 'chofer');
insert into clientes (id, nombre, rut) values ('$CL', 'Cliente carrera clave', '3-5');
SQL

DATOS="{\"clave\":\"$CLAVE_T\",\"cliente_id\":\"$CL\",\"area\":\"afilado\",\"entrada\":\"ruta_propia\",\"lineas\":[{\"producto\":\"Cuchillo\",\"cantidad\":6}]}"
for i in $(seq 1 "$N"); do
  (
    if "${PSQL[@]}" >"$SALIDA/id.$i" 2>"$SALIDA/err.$i" <<SQL
set role authenticated;
set request.jwt.claims = '{"sub":"$CH"}';
begin;
select pg_sleep(0.05) \g /dev/null
select id from crear_trabajo('$DATOS'::jsonb);
select pg_sleep(0.2) \g /dev/null
commit;
SQL
    then echo ok >"$SALIDA/res.$i"; else echo falla >"$SALIDA/res.$i"; fi
  ) &
done
wait
OK_T=$(cat "$SALIDA"/res.* | grep -c '^ok$' || true)
IDS=$(cat "$SALIDA"/id.* | sort -u | grep -c . || true)
TRABAJOS=$("${PSQL[@]}" -c "select count(*) from trabajos where cliente_id = '$CL'")
LINEAS=$("${PSQL[@]}" -c "select count(*) from lineas l join trabajos t on t.id = l.trabajo_id where t.cliente_id = '$CL'")
LINEA=$("${PSQL[@]}" -c "select l.id from lineas l join trabajos t on t.id = l.trabajo_id where t.cliente_id = '$CL' limit 1")

# Deja las 6 unidades listas (como superusuario: preparación) y entrega 2 con la misma clave N veces.
"${PSQL[@]}" <<SQL
insert into movimientos (linea_id, cantidad, etapa_origen_id, etapa_destino_id, usuario_id)
  select '$LINEA', 6, r.id, l.id, '$CH' from etapas r, etapas l
   where r.area = 'afilado' and r.nombre = 'Recibido' and l.area = 'afilado' and l.nombre = 'Listo';
SQL
rm -f "$SALIDA"/res.* "$SALIDA"/err.*
for i in $(seq 1 "$N"); do
  (
    if "${PSQL[@]}" >/dev/null 2>"$SALIDA/err.$i" <<SQL
set role authenticated;
set request.jwt.claims = '{"sub":"$CH"}';
begin;
select pg_sleep(0.05);
select entregar_unidades('[{"linea_id":"$LINEA","cantidad":2}]', 'G-77', '$CLAVE_E');
select pg_sleep(0.2);
commit;
SQL
    then echo ok >"$SALIDA/res.$i"; else echo falla >"$SALIDA/res.$i"; fi
  ) &
done
wait
OK_E=$(cat "$SALIDA"/res.* | grep -c '^ok$' || true)
ENTREGADAS=$("${PSQL[@]}" -c "select unidades_en_etapa('$LINEA', id) from etapas where area = 'afilado' and nombre = 'Entregado'")
GUIA=$("${PSQL[@]}" -c "select guia_despacho from trabajos where cliente_id = '$CL'")
limpiar

echo "crear_trabajo: sesiones=$N exitosas=$OK_T ids_distintos=$IDS trabajos=$TRABAJOS lineas=$LINEAS"
echo "entregar_unidades: sesiones=$N exitosas=$OK_E entregadas=$ENTREGADAS guía=$GUIA"
if [[ "$OK_T" -eq "$N" && "$IDS" -eq 1 && "$TRABAJOS" -eq 1 && "$LINEAS" -eq 1 \
      && "$OK_E" -eq "$N" && "$ENTREGADAS" -eq 2 && "$GUIA" == "G-77" ]]; then
  echo "carrera de reintentos OK: la misma clave crea un solo trabajo y entrega una sola vez"
else
  echo "carrera de reintentos FALLÓ" >&2
  head -n 3 "$SALIDA"/err.* >&2 || true
  exit 1
fi
