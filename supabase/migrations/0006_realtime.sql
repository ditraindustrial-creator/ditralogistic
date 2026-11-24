-- La pantalla "Qué hay listo" se actualiza en vivo: Realtime debe publicar los cambios de movimientos.
-- (RLS sigue aplicando: cada usuario solo recibe los eventos de filas que puede leer.)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'movimientos'
  ) then
    alter publication supabase_realtime add table movimientos;
  end if;
end $$;
