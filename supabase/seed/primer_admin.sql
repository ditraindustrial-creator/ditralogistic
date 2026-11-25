-- =====================================================================================
-- PRIMER ADMINISTRADOR (y demás usuarios) — se ejecuta a mano, UNA VEZ por persona
-- =====================================================================================
-- Por qué existe: en Supabase, crear un usuario (Authentication → Users) solo crea su
-- correo y clave. La app además necesita una fila en la tabla "perfiles" que diga su
-- NOMBRE y su ROL. Sin esa fila, la persona puede entrar pero la app no le muestra nada
-- (o dice que no tiene permisos), porque todas las reglas de acceso (RLS) dependen del rol.
--
-- El primer admin NO se puede crear desde la app (nadie tiene permiso todavía), por eso
-- se hace aquí, en el SQL Editor de Supabase (corre con permisos de propietario).
--
-- PASOS
--  1. Supabase → Authentication → Users → "Add user" → "Create new user".
--     Escribe el correo y una clave; marca "Auto Confirm User" para que pueda entrar sin
--     confirmar correo. Anota el correo exacto.
--  2. Supabase → SQL Editor → New query → pega ESTE archivo.
--  3. Cambia los 3 valores marcados con  <<<  (correo, nombre, rol) y ejecuta (Run).
--  4. Resultado esperado: "Success. 1 row" y, al final, una fila con el correo, el nombre
--     y el rol. Si dice "0 rows", el correo no coincide con el de Authentication.
--
-- ROLES VÁLIDOS (escribir exactamente así, en minúsculas y con guion bajo):
--   admin                     todo, incluida Administración (clientes, recorridos, productos)
--   secretaria                todo lo operativo (recepción, taller, rutas, entregas, reporte)
--   jefe_taller               igual que secretaria
--   chofer                    hoja de ruta, ruta de mañana, recepción (retiros) y entregas
--   operario_afilado          Qué hay listo + Taller, solo del área de afilado
--   operario_encuadernacion   Qué hay listo + Taller, solo del área de encuadernación
--
-- Este archivo NO contiene claves ni datos reales: son valores de ejemplo para reemplazar.
-- Es seguro ejecutarlo más de una vez: si el perfil ya existe, lo actualiza (nombre y rol).
-- =====================================================================================

insert into perfiles (usuario_id, nombre, rol)
select u.id,
       'Nombre Apellido',        -- <<< nombre que verá la persona ("Hola, ...")
       'admin'::rol              -- <<< rol: admin | secretaria | jefe_taller | chofer | operario_afilado | operario_encuadernacion
from auth.users u
where u.email = 'dueno@ejemplo.cl'   -- <<< el correo EXACTO con que creaste el usuario en Authentication
on conflict (usuario_id) do update set nombre = excluded.nombre, rol = excluded.rol;

-- Comprobación: debe listar al usuario recién creado con su rol.
select u.email, p.nombre, p.rol
from perfiles p join auth.users u on u.id = p.usuario_id
order by u.email;

-- =====================================================================================
-- OTROS USUARIOS: mismo procedimiento. Para cada persona: (1) créala en Authentication →
-- Users, (2) repite el bloque "insert into perfiles" cambiando correo, nombre y rol.
-- Varias personas de una vez:
--
--   insert into perfiles (usuario_id, nombre, rol)
--   select u.id, v.nombre, v.rol::rol
--   from (values
--     ('secretaria@ejemplo.cl', 'Ana Pérez',   'secretaria'),
--     ('chofer1@ejemplo.cl',    'Luis Soto',    'chofer'),
--     ('afilado1@ejemplo.cl',   'Marta Rojas',  'operario_afilado')
--   ) as v(correo, nombre, rol)
--   join auth.users u on u.email = v.correo
--   on conflict (usuario_id) do update set nombre = excluded.nombre, rol = excluded.rol;
--
-- CAMBIAR EL ROL O NOMBRE DE ALGUIEN:
--   update perfiles set rol = 'jefe_taller'
--   where usuario_id = (select id from auth.users where email = 'alguien@ejemplo.cl');
--
-- DAR DE BAJA A ALGUIEN (no puede entrar y se conserva su historial de movimientos):
--   Authentication → Users → ⋯ → "Ban user"  (NO borrar el usuario: los movimientos que
--   registró apuntan a su perfil y no se pueden dejar huérfanos).
-- =====================================================================================
