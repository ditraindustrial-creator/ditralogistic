#!/usr/bin/env bash
# Valida las migraciones y corre supabase/tests/*.test.sql contra un PostgreSQL local, sin
# Docker ni Supabase. Crea una base desechable con stubs de auth y un shim de pgTAP.
# Uso (como un usuario con acceso de superusuario a Postgres, p. ej. postgres):
#   scripts/sql-local/correr_pruebas.sh            # base: trazabilidad_pruebas
#   DB=otra scripts/sql-local/correr_pruebas.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
DB="${DB:-trazabilidad_pruebas}"
PSQL=(psql -X -q -v ON_ERROR_STOP=1 -d "$DB")

dropdb --if-exists "$DB"
createdb "$DB"
"${PSQL[@]}" -f scripts/sql-local/stubs_supabase.sql
for m in supabase/migrations/*.sql; do
  echo "== migración $m"
  "${PSQL[@]}" -f "$m"
done
"${PSQL[@]}" -f scripts/sql-local/grants_supabase.sql
"${PSQL[@]}" -f scripts/sql-local/pgtap_shim.sql

for t in supabase/tests/*.test.sql; do
  echo "== prueba $t"
  "${PSQL[@]}" -f "$t"
done

echo "== carrera con sesiones psql paralelas"
DB="$DB" scripts/sql-local/carrera_mover_unidades.sh

echo "== carrera de entregas con sesiones psql paralelas"
DB="$DB" scripts/sql-local/carrera_entregar_unidades.sh

echo "== carrera de reintentos con la misma clave de idempotencia"
DB="$DB" scripts/sql-local/carrera_clave_idempotencia.sh
