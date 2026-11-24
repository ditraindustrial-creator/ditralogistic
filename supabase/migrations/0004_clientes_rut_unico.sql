-- La importación de clientes es idempotente por RUT: el RUT debe ser único (formato 12345678-5).
-- Si ya hubiera clientes con RUT repetido, esta migración falla a propósito: hay que fusionarlos antes.
create unique index clientes_rut_unico on clientes (rut);
