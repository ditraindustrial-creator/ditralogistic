-- 0008: la foto del documento firmado solo puede ser JPG, PNG, WebP o HEIC.
-- 0007 dejó `image/*`, que también admite SVG (un SVG puede llevar scripts). Se cambia por la lista exacta;
-- debe coincidir con TIPOS_FOTO_DOCUMENTO en src/dominio/entrega.ts.
update storage.buckets
   set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/heic']
 where id = 'documentos';
