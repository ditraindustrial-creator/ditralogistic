# Puesta en marcha: lista de pasos y prueba de humo

Esta guía es para quien lanza la app por primera vez (el dueño, con ayuda de un asistente de IA si lo desea). Cada paso dice **qué debe pasar**. Si algo no coincide, no avances: ve a la sección "Si algo falla".

> **Importante:** hasta hoy esta app **nunca se ha probado contra un Supabase real**. Todo el código y todo el SQL se probaron con una base PostgreSQL local y con datos simulados. Trata el primer arranque como una **prueba de verificación**: hazlo con datos de práctica y borra esos datos antes de usarla de verdad (ver «Cierre de la prueba», al final de la Parte B).

> **Los nombres de menús y botones de Supabase y Cloudflare** de esta guía se escribieron de memoria y esos paneles cambian seguido: si un nombre no coincide, busca la opción equivalente (por ejemplo "Settings" en vez de "Project Settings"). Los textos **de la app** sí se copiaron del código.

Lo que necesitas: una cuenta de Supabase y una de Cloudflare (o Vercel), **a nombre de la empresa**; una cuenta de GitHub con este repositorio; un celular; y 2 a 3 horas la primera vez.

## Parte A. Dejar todo funcionando

### 1. Crear el proyecto en Supabase
1. Entra a <https://supabase.com> con la cuenta de la empresa → **New project**.
2. Nombre, por ejemplo `trazabilidad`. Región: la más cercana a Chile disponible (por ejemplo São Paulo). Define una contraseña de base de datos y **guárdala en el gestor de claves de la empresa** (no se usa en la app).
3. Espera a que termine ("Setting up project" desaparece).

**Resultado esperado:** ves el panel del proyecto con el menú de la izquierda (Table Editor, SQL Editor, Authentication...).

### 2. Aplicar las migraciones, en orden
En **SQL Editor → New query**, pega el contenido completo de cada archivo de `supabase/migrations/` **en este orden**, y pulsa **Run** después de cada uno. No te saltes ninguno ni cambies el orden:

| Orden | Archivo | Qué hace |
|---|---|---|
| 1 | `0001_esquema.sql` | Tablas, roles, permisos (RLS) y las etapas iniciales |
| 2 | `0002_mover_unidades.sql` | Mover unidades entre etapas de forma segura |
| 3 | `0003_productos.sql` | Catálogo de productos |
| 4 | `0004_clientes_rut_unico.sql` | RUT único por cliente |
| 5 | `0005_recepcion.sql` | Crear un trabajo con sus líneas (`crear_trabajo`) |
| 6 | `0006_realtime.sql` | Activa las actualizaciones en vivo de `movimientos` |
| 7 | `0007_ruta.sql` | Visitas de ruta, entregas con documento (`entregar_unidades`) |
| 8 | `0008_ajustes_finales.sql` | Entregas solo con documento, correcciones solo de gestión, reintentos sin duplicar, transporte de encomienda |
| 9 | `0009_cliente_recorridos.sql` | Un cliente en varios recorridos (fijo o a pedido, con orden) y chofer titular de cada recorrido |

**Resultado esperado de cada uno:** "Success. No rows returned". En **Table Editor** aparecen las tablas `perfiles`, `recorridos`, `clientes`, `etapas`, `trabajos`, `lineas`, `movimientos`, `visitas`, `productos`, `entregas_registradas`, `cliente_recorridos`; y la tabla `etapas` trae 9 filas (5 de afilado, 4 de encuadernación).

Alternativa para quien sepa usar la terminal: con la CLI de Supabase, `supabase link --project-ref <ref>` y `supabase db push`. No se ha probado en este repositorio (no hay `supabase/config.toml`); el SQL Editor es el camino verificado.

### 3. Comprobar que Realtime quedó activo para `movimientos`
En el SQL Editor ejecuta:

```sql
select tablename from pg_publication_tables where pubname = 'supabase_realtime';
```

**Resultado esperado:** una fila `movimientos`. Si no aparece: ejecuta `alter publication supabase_realtime add table movimientos;`, o activa **Database → Replication** (o **Realtime**) → tabla `movimientos` desde el panel.

### 4. Crear al primer administrador
1. **Authentication → Users → Add user → Create new user**: correo y clave; marca **Auto Confirm User**.
2. Abre `supabase/seed/primer_admin.sql`, cambia los tres valores marcados con `<<<` (correo, nombre, rol `admin`) y ejecútalo en el SQL Editor.

**Resultado esperado:** al final aparece una fila con el correo, el nombre y `admin`.

3. **Cerrar el registro abierto:** en **Authentication → Sign In / Providers** (o **Authentication → Settings**, según la versión del panel) desactiva **"Allow new users to sign up"** y guarda. Los usuarios los crea solo el administrador (pasos 4 y 8); con el registro abierto, cualquiera con la dirección de la app podría crearse una cuenta (sin perfil no ve datos, pero no debe poder entrar).

**Resultado esperado:** la opción queda apagada. Crear usuarios desde **Add user** sigue funcionando.

### 5. Copiar las dos claves públicas del proyecto
**Project Settings → API** (o "API Keys"):
- **Project URL** → será `VITE_SUPABASE_URL`.
- Clave **anon / public** (en el panel nuevo puede llamarse "publishable key") → será `VITE_SUPABASE_ANON_KEY`.

La clave anon es pública por diseño (viaja dentro de la app) y la protegen las reglas de acceso (RLS) de las migraciones. **Nunca uses ni copies la clave `service_role` / "secret": da acceso total y saltaría todas las protecciones. No va en la app, ni en GitHub, ni en Cloudflare.**

### 6. Publicar en Cloudflare Pages (o Vercel)
Cloudflare: **Workers & Pages → Create → Pages → Connect to Git** → elige el repositorio y la rama de producción. Configuración:

| Campo | Valor |
|---|---|
| Framework preset | Vite (o ninguno) |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Variable `NODE_VERSION` | `22` |
| Variable `VITE_SUPABASE_URL` | la URL del paso 5 |
| Variable `VITE_SUPABASE_ANON_KEY` | la clave anon del paso 5 |

(Vercel: mismos valores; el preset es "Vite".) Las variables `VITE_...` se leen **al construir**: si las cambias después, hay que volver a desplegar.

**Resultado esperado:** el despliegue termina en verde y te da una dirección `https://....pages.dev`. Al abrirla ves "Iniciar sesión" (si ves "Falta configurar la aplicación", faltan las variables: corrígelas y redespliega).

### 7. Abrir en el celular e instalar
1. En el celular abre la dirección del paso 6 y entra con el administrador creado.
2. **Android (Chrome):** menú ⋮ → "Instalar app" / "Agregar a pantalla principal". **iPhone (Safari):** botón Compartir → "Agregar a inicio".

**Resultado esperado:** aparece un ícono verde con una palomita blanca; al abrirlo desde ahí, la app se ve a pantalla completa, sin barra del navegador.

### 8. Crear los demás usuarios
Por cada persona: créala en Authentication → Users (con Auto Confirm) y agrega su perfil con el rol correcto (instrucciones y plantilla en `supabase/seed/primer_admin.sql`). Para la prueba de humo crea al menos: una secretaria, un chofer, un operario de afilado y un operario de encuadernación.

## Parte B. Prueba de humo (30 a 40 minutos, dos dispositivos)

Usa dos aparatos: por ejemplo un celular y un computador, o dos celulares. Los datos que crees son de práctica. Marca cada punto; si uno falla, detente y mira "Si algo falla". Los textos entre comillas son los que muestra la app, tal cual.

**Hazla un día hábil (lunes a viernes).** La Hoja de ruta muestra los recorridos del día de hoy: por eso en el punto 2 se crean **dos** recorridos para el día de la semana de hoy ("Prueba hoy" y "Prueba hoy 2") y uno para el próximo día hábil ("Prueba mañana"). Ejemplo: si hoy es martes, "Prueba hoy" y "Prueba hoy 2" son de martes y "Prueba mañana" de miércoles (si hoy es viernes, "Prueba mañana" es de lunes, que es lo que muestra "Ruta de mañana").

Un cliente puede estar en varios recorridos. En cada uno es **fijo** (se pasa siempre ese día; si no hay nada que entregar sale en "Pasar a retirar") o **a pedido** (sale ese día solo si tiene algo listo para entregar por ruta propia o una visita solicitada o confirmada "Sí"). En la prueba, Cliente Prueba A es fijo en "Prueba hoy", B es fijo en "Prueba mañana" y C es **a pedido** en "Prueba hoy 2".

Archivos de práctica (guárdalos como `.csv` con un editor de texto o desde Excel):

```
nombre;rut;contacto;direccion
Cliente Prueba A;11.111.111-1;Ana;Calle 1
Cliente Prueba B;22.222.222-2;Beto;Calle 2
Cliente Prueba C;33.333.333-3;Carla;Calle 3
```

```
codigo;nombre;area
CU-20;Cuchillo;afilado
DI-10;Disco;afilado
LI-01;Libro tapa dura;encuadernacion
```

```
recorrido;rut;fija;orden
Prueba hoy;11.111.111-1;sí;1
Prueba mañana;22.222.222-2;sí;1
Prueba hoy 2;33.333.333-3;no;1
```

(El tercero es el archivo de **recorridos de clientes**: una fila por cliente y recorrido; la plantilla de ejemplo está en `docs/plantilla-asignaciones.csv`.)

Los números de trabajo que se citan (N.º 1, 2, 3) suponen una base sin trabajos; si ya hubo intentos, verás otros números (nunca se repiten, puede haber saltos).

| # | Quién | Qué hacer | Resultado esperado |
|---|---|---|---|
| 1 | Admin | Entrar con correo y clave. | Saluda "Hola, <nombre>". El menú (botones en filas) muestra: Recepción, Taller / Producción, Ruta de mañana, Hoja de ruta, Reporte diario, Administración; debajo, sin bajar la pantalla, el título "Qué hay listo" y "No hay trabajos en curso que coincidan con los filtros." |
| 2 | Admin | Administración → pestaña **Recorridos**. Después de cada "Guardar recorrido" el formulario **conserva** chofer, camioneta y Lejano y pasa solo al día siguiente (para cargar rápido la semana de un chofer): revisa cada campo antes de guardar. (a) "Prueba hoy": Día = el día de la semana de hoy, Chofer titular vacío, Camioneta "Camioneta 1", sin Lejano → "Guardar recorrido". (b) "Prueba hoy 2": Día = **otra vez** el de hoy, Chofer titular = el nombre **exacto** del perfil del chofer creado en la Parte A (punto 8), Camioneta "Camioneta 2", sin Lejano. (c) "Prueba mañana": Día = el próximo día hábil, Chofer titular **vacío** (bórralo), Camioneta "Camioneta 2", **marcar Lejano**. | Los tres aparecen en la lista: "Prueba hoy · <día> · Camioneta 1", "Prueba hoy 2 · <día> · Camioneta 2 · Chofer: <nombre>" y "Prueba mañana · <día> · Camioneta 2 · lejano". |
| 3 | Admin | Pestaña **Clientes** → "Archivo de clientes (CSV)": elegir el archivo de clientes de arriba; las columnas se sugieren solas → "Importar clientes". Luego elegir **el mismo archivo** otra vez e importar. | La primera vez: "3 clientes nuevos, 0 actualizados, 0 sin cambios."; la segunda: "0 clientes nuevos, 0 actualizados, 3 sin cambios." (no duplica). Si agregas una fila con RUT `abc`, sale "1 fila no se importó:" y "Fila 5: El RUT "abc" no es válido." y las demás igual se importan. |
| 4 | Admin | Pestaña **Clientes** → "Archivo de recorridos de clientes (CSV)": elegir el archivo `recorrido;rut;fija;orden` de arriba (las columnas se sugieren solas) → "Importar recorridos de clientes". Luego **el mismo archivo** otra vez. Revisar las tarjetas de los clientes. Pestaña **Productos**: importar el archivo de productos. | Primera vez: "3 asignaciones nuevas, 0 actualizadas, 0 sin cambios, 0 errores."; segunda: "0 asignaciones nuevas, 0 actualizadas, 3 sin cambios, 0 errores." (no duplica). En la tarjeta de Cliente Prueba A: "Prueba hoy (<Día>)" con "fijo" marcado y Orden 1; en la de C: "Prueba hoy 2 (<Día>)" con "a pedido". (A mano es lo mismo: "Agregar <cliente> a un recorrido" → "Agregar", y la casilla "Fijo" / el Orden de cada fila.) Al recargar la página siguen ahí. Productos: "3 productos nuevos, 0 actualizados, 0 sin cambios." |
| 5 | Secretaria | Entrar. Revisar el menú. | Recepción, Taller / Producción, Ruta de mañana, Hoja de ruta, Reporte diario, **Administración** y abajo "Qué hay listo". (Gestión — admin, secretaria y jefe de taller — ve Administración para gestionar recorridos.) |
| 6 | Secretaria | **Recepción**: en "Cliente" escribir `prueba a` y tocar "Cliente Prueba A". Área "Afilado". En "¿Cómo llegó?" elegir **"Ruta propia (retiro)"** (así sale por la camioneta; con "Lo trajo el cliente" iría a "Retiran en mostrador"). Línea 1: `Cuchillo`, 6; "Agregar línea"; línea 2: `Disco`, 4 → "Guardar trabajo". | "Trabajo N.º 1 guardado". En Taller / Producción aparecen "Cuchillo · 6" con "Recibido 6" y "Disco · 4" con "Recibido 4". En "Qué hay listo", bajo "Prueba hoy · <día abreviado> <d/m> (hoy)" (por ejemplo "Prueba hoy · Mar 24/11 (hoy)": cada grupo es la próxima pasada de la camioneta): "Cliente Prueba A", "0 de 10 listas", "Rutas: <día abreviado>", "Aún no hay unidades listas". |
| 7 | Secretaria | **Cliente nuevo**: "Recibir otro trabajo"; en "Cliente" escribir `Cliente Prueba D`. Tocar **"Cliente nuevo"**, escribir RUT `44.444.444-4` → "Guardar cliente". Luego tocar "Cambiar cliente" → "Cliente nuevo" otra vez, con nombre `Repetido` y RUT `11.111.111-1` → "Guardar cliente". | Con la búsqueda vacía de resultados sale "No hay clientes con ese nombre o RUT."; el formulario trae el nombre ya escrito y dice "Los recorridos del cliente (qué días se le visita) se asignan en Administración." (no hay campo de recorrido); al guardar, el cliente queda elegido (con "Cambiar cliente"). Con el RUT repetido: "Ya existe un cliente con ese RUT. Búscalo por nombre o RUT en vez de crearlo de nuevo." (No guardes trabajo aquí: toca "Cancelar".) |
| 8 | Chofer | Entrar. | Menú: "Hoja de ruta" (primero), "Recepción", "Ruta de mañana". **No** ve Taller, Reporte, Administración ni "Qué hay listo". |
| 9 | Chofer | **Recepción** (retiro en terreno): cliente "Cliente Prueba C", Área "Encuadernación"; "Ruta propia (retiro)" ya viene marcado. Línea: `Libro tapa dura`, 10 → "Guardar trabajo". | "Trabajo N.º 2 guardado". |
| 10 | Operario de afilado | Entrar. Taller: tocar "Cuchillo · 6"; Cantidad 3 → "Mover". Tocar la línea otra vez; en "Desde" elegir "En taller (3)"; en "Pasar a" elegir "Listo" → "Mover". Probar también Cantidad 9 desde "Recibido (3)". | Solo ve trabajos de afilado (no el "Libro tapa dura"). Mensajes: "3 unidades pasaron a En taller" y "3 unidades pasaron a Listo". Con 9: "Solo hay 3 unidades en esta etapa; no se pueden mover 9." y nada cambia. |
| 11 | Admin en el otro dispositivo | Mantener abierta la pantalla de inicio ("Qué hay listo") mientras el operario mueve unidades a "Listo" (punto 10). | **Sin recargar**, en pocos segundos "Cliente Prueba A" muestra "3 de 10 listas" y "Listo desde hoy HH:MM". (Prueba de Realtime.) |
| 12 | Operario de afilado | Revisar el menú; en Taller abrir "Cuchillo · 6". | Menú: solo "Taller / Producción" y abajo "Qué hay listo". En "Pasar a" no aparece "Entregado" y se lee "Solo secretaría, jefe de taller o chofer registran entregas." No hay Ruta ni Hoja de ruta. |
| 13 | Secretaria | **Ruta de mañana** (la fecha viene puesta en el próximo día hábil). | "No hay entregas por ruta para esta fecha." (lo listo es de "Prueba hoy") y "Hay 1 trabajo listo para otros días de ruta (no entra en esta fecha)." Sección **"Pasar a retirar (1)"** plegada, con "Clientes fijos del recorrido (y visitas pedidas) sin nada que entregar · 1 por confirmar." → "Mostrar": "Prueba mañana · Camioneta 2", "Cliente Prueba B" con la marca "Fijo", "Visita: Sin respuesta", botones Sí / No / Sin respuesta. Tocar **"Sí"**: queda marcado y desaparece "1 por confirmar". "Agregar visita extra" → "Cliente Prueba C", nota `Retira cheques` → "Agregar": "Visita agregada: Cliente Prueba C" y aparece en "Pasar a retirar (2)" bajo "Visitas extra" con "Nota: Retira cheques". |
| 14 | Chofer | **Hoja de ruta** (fecha de hoy): tarjeta "Cliente Prueba A". Tocar "Sí" en la visita. Tocar **"Entregar"**: la cantidad de Cuchillo viene en 3; en "N° de documento (guía o factura)" escribir `G-1001` → "Entregar" → "Listo". | Solo sale el recorrido "Prueba hoy" (sin selector de recorrido): **"Cliente Prueba C" no aparece**, porque es a pedido en "Prueba hoy 2" y todavía no tiene nada listo. La tarjeta de A tiene la marca "Fijo". "Todo lo listo: Cuchillo 3". La visita queda en "Sí". "Entrega registrada: 3 unidades · Documento G-1001". La tarjeta pasa a "Pasar a retirar (1)". En "Qué hay listo": "0 de 7 listas", "Aún no hay unidades listas", "3 entregadas · 10 en el pedido". |
| 15 | Operario + chofer (dos aparatos) | El operario abre "Disco · 4", elige "Pasar a: Listo", Cantidad 2 → "Mover". En **dos aparatos** con Hoja de ruta abierta (chofer, y secretaria o jefe), tocar "Entregar" en "Cliente Prueba A" a la vez, con documentos `G-1002` y `G-1003`. | Un aparato registra "Entrega registrada: 2 unidades · Documento G-1002" (o G-1003). El otro muestra "«Disco» tiene 0 unidades listas; no se pueden entregar 2 (faltan 2)." o, si ya se actualizó, "No hay unidades listas para entregar.". Nunca se entrega más de lo listo. "Qué hay listo": "0 de 5 listas", "5 entregadas · 10 en el pedido". |
| 16 | Secretaria y operario | **Corrección solo de gestión**: la secretaria abre en Taller "Cuchillo · 6"; el operario abre la misma línea. (No muevas nada.) | La secretaria ve "Desde" con "Recibido (3)" y "Entregado (3)" (puede devolver unidades entregadas por error). El operario no ve "Desde" ni "Entregado (3)" como origen. |
| 17 | Secretaria | **Encomienda**: Recepción → "Cliente Prueba D", Afilado, "¿Cómo llegó?" = **"Encomienda"**, línea `Disco` 2 → "Guardar trabajo". En Taller abrir la línea "Disco · 2" de "Cliente Prueba D", "Pasar a: Listo" → "Mover". En Ruta de mañana, sección **"Por encomienda"**, tocar **"Despachar"**; documento `G-2001` y "Transporte (empresa y N° de guía de transporte, opcional)" `Starken 123456` → "Entregar". | "Trabajo N.º 3 guardado". El panel se titula "Despachar por encomienda". "Entrega registrada: 2 unidades · Documento G-2001 · Transporte Starken 123456"; al tocar "Listo" la sección "Por encomienda" desaparece y el trabajo sale de "Qué hay listo". En Table Editor → `trabajos`, el N.º 3 tiene `guia_despacho` = `G-2001` y `transporte` = `Starken 123456`. |
| 18 | Operario de encuadernación | Entrar y abrir Taller: "Libro tapa dura · 10": pasar 7 de "Recibido" a "En producción"; luego, "Desde" "En producción (7)", pasar 3 a "Terminado". | Solo ve trabajos de encuadernación. "7 unidades pasaron a En producción" y "3 unidades pasaron a Terminado". |
| 19 | Chofer | **Hoja de ruta** otra vez (fecha de hoy). Luego tocar "Prueba hoy · Camioneta 1" en el selector. | Ahora hay un selector "Recorrido" con "Prueba hoy · Camioneta 1" y "Prueba hoy 2 · Camioneta 2", y viene elegido **"Prueba hoy 2"** (su chofer titular es quien inició sesión). Ahí está "Cliente Prueba C" con la marca **"A pedido"** y "Todo lo listo: Libro tapa dura 3" (salió porque ya tiene algo listo por ruta propia). Al tocar "Prueba hoy · Camioneta 1" se ve "Pasar a retirar (1)" con Cliente Prueba A. |
| 20 | Jefe de taller o secretaria | **Reporte diario** (fecha de hoy). | "Listo hoy": Cliente Prueba C · Trabajo N.º 2 · Libro tapa dura · 3 unidades, con la hora. "En producción": 4 unidades. "Por entregar": 3 unidades. "Recién recibido": 3 unidades. (El reporte es solo de encuadernación.) |
| 21 | Cualquiera con acceso | En Reporte diario pulsar **Imprimir** (o Ctrl+P). Lo mismo en Ruta de mañana. | La vista previa sale limpia: sin "Salir", "← Menú" ni "Imprimir". En la ruta, la lista "Pasar a retirar" sale **completa** aunque en pantalla esté plegada. |
| 22 | Todos | Cerrar sesión y entrar de nuevo; cerrar y reabrir la app instalada. | Vuelve a la sesión o pide clave; nunca muestra datos sin iniciar sesión. |
| 23 | Admin | Revisar **Authentication → Users** y la tabla `movimientos` (Table Editor). | Cada movimiento registra el usuario correcto y la hora. Hay un movimiento por cada paso hecho; ninguno repetido. |

**Cierre de la prueba:**

> **ATENCIÓN: SOLO si el proyecto no tiene datos reales. Esto borra todo y no se puede deshacer.** Si ya hay trabajos reales, NO ejecutes esto: exporta primero cada tabla (Table Editor → Export to CSV) o confirma que existe un respaldo, y borra a mano solo las filas de prueba.

En el SQL Editor:

```sql
truncate movimientos, lineas, trabajos, visitas, entregas_registradas restart identity;
```

Esto vacía **exactamente** `movimientos`, `lineas`, `trabajos`, `visitas` y `entregas_registradas` (los trabajos de práctica, su historial y las claves de sus entregas) y reinicia el contador de N.º de trabajo en 1. **No toca** `perfiles` (usuarios), `clientes`, `recorridos`, `cliente_recorridos`, `productos` ni `etapas`; se verificó contra las claves foráneas de las migraciones y se probó en la base local. Los clientes, recorridos y productos de práctica, si los hay, bórralos a mano en el Table Editor (al borrar un cliente o un recorrido se borran solas sus filas de `cliente_recorridos`; un cliente con trabajos no se puede borrar hasta vaciar los trabajos).

## Si algo falla

**No puedo entrar / "Invalid login credentials".** Revisa el correo y la clave en Authentication → Users; si el usuario figura sin confirmar, ábrelo y confírmalo (o créalo con Auto Confirm).

**Entro, pero la app no muestra nada o dice que no tienes permisos.** Casi seguro falta la fila en `perfiles` (paso 4/8). Comprueba con `select u.email, p.rol from perfiles p join auth.users u on u.id = p.usuario_id;`. Si el correo no aparece, ejecuta de nuevo el insert de `supabase/seed/primer_admin.sql`.

**La app dice "No tienes permiso…" en una acción que ese rol sí debería poder hacer.** La app traduce los errores técnicos; el mensaje original se ve en Supabase → **Logs** (API / Postgres) o en el navegador del computador (F12 → Red → la respuesta en rojo). Hay dos casos distintos:

- **`permission denied for table <tabla>`** (código 42501): **faltan los permisos de tabla** (grants) del rol `authenticated`; no es una regla RLS. Supabase los da por defecto en el esquema `public`; si se perdieron, ejecuta en el SQL Editor:
  ```sql
  grant usage on schema public to authenticated;
  grant select, insert, update, delete on all tables in schema public to authenticated;
  grant usage, select on all sequences in schema public to authenticated;
  ```
- **`new row violates row-level security policy for table <tabla>`** (o "row-level security"): es una regla de acceso (RLS) actuando; sigue el párrafo siguiente.

**Mensaje de "permiso denegado" / "row-level security" / "new row violates row-level security policy" al guardar.** Es una regla de acceso (RLS) actuando. Primero verifica que el usuario tenga el rol correcto (arriba). Si el rol es correcto y la acción es legítima, es un **error nuestro**: copia el mensaje completo, indica qué usuario (rol) hacía qué, y entrégaselo al asistente de IA junto con `supabase/migrations/0001_esquema.sql`, `0007_ruta.sql` y `0008_ajustes_finales.sql`; las políticas de RLS están ahí. No desactives RLS "para que funcione": dejaría los datos abiertos a cualquiera con la clave pública.

**Lista vacía aunque hay datos (por rol).** Los operarios solo ven su área; los choferes solo lo que corresponde a su ruta. Compara con el rol que corresponde.

**"Qué hay listo" no se actualiza solo.** (1) Repite el paso 3 y confirma que `movimientos` está en la publicación `supabase_realtime`. (2) En Supabase → Project Settings → API / Realtime, confirma que Realtime está habilitado. (3) Mira la consola del navegador del dispositivo (en el computador: F12) por errores de WebSocket; una red de empresa que bloquee WebSockets lo impide. (4) Mientras tanto, recargar la pantalla muestra el dato correcto: el estado real está siempre en la base; solo la actualización en vivo falla.

**Al importar recorridos de clientes sale "El recorrido "…" no existe" o "No hay ningún cliente con RUT …".** El nombre del recorrido del archivo debe ser el mismo de la pestaña Recorridos (da igual mayúsculas, tildes y espacios de más) y el cliente ya debe estar importado (se busca por RUT, con o sin puntos). Las demás filas se importan igual; corrige esas en Excel y vuelve a importar el archivo completo (no duplica). Si un cliente aparece dos veces en el mismo recorrido, vale la primera fila y la otra se informa como error.

**Un error al aplicar una migración.** Anota el número de la migración y el mensaje completo. Causas típicas: se ejecutó fuera de orden (`relation ... does not exist`) o se ejecutó dos veces (`already exists`). Si una migración falló a medias, no sigas con la siguiente. **ATENCIÓN: volver a empezar de cero BORRA TODOS LOS DATOS y no se puede deshacer. Hazlo SOLO si el proyecto no tiene datos reales** (un proyecto recién creado y vacío). Si ya hay datos reales, primero exporta cada tabla (Table Editor → Export to CSV) o confirma que hay un respaldo, y pide ayuda en vez de borrar. En un proyecto vacío, lo más simple es crear un proyecto Supabase nuevo y aplicar las migraciones desde la 0001 (o borrar el proyecto fallido). Entrégale el mensaje al asistente de IA; las migraciones se probaron en PostgreSQL 16 con una simulación de Supabase, así que pueden existir diferencias menores con el real.

**Aparece "Falta configurar la aplicación".** Faltan `VITE_SUPABASE_URL` o `VITE_SUPABASE_ANON_KEY` en el hosting. Agrégalas y vuelve a desplegar.

**La app instalada no se actualiza tras un cambio.** Cierra la app por completo y ábrela dos veces (la actualización se aplica sola al volver a abrir).

## Cómo corregir un error

La app **no tiene "anular"**: nada se borra, todo queda en el historial con usuario y hora. Para corregir se usan estos caminos (solo **gestión**: secretaria, jefe de taller o administrador).

**1. Un trabajo recibido con datos equivocados (cantidad o cliente).** No se puede editar ni borrar. Se "cierra" y se recibe de nuevo bien:
1. En **Taller / Producción**, abre cada línea del trabajo equivocado y pasa **todas** sus unidades a la etapa "Listo" (o "Terminado" en encuadernación), con "Desde" cada etapa donde haya unidades.
2. Con "Desde: Listo" elige "Pasar a: Entregado" → **"Entregar…"** y en "N° de documento" escribe **`ANULADO`** → "Entregar". Repite en cada línea.
3. Recibe el trabajo correcto en Recepción.

Qué queda: el trabajo equivocado figura como **entregado completo con el documento `ANULADO`**; sale de "Qué hay listo", del Taller y de la ruta. **No se puede deshacer** (el historial no se borra) y el número de trabajo no se reutiliza. Efecto secundario: en el Reporte diario de encuadernación de ese día esas unidades cuentan en "Listo hoy". Para ver todos los trabajos anulados, en el SQL Editor:

```sql
select t.numero, c.nombre as cliente, t.recibido_en::date as recibido, t.guia_despacho
  from trabajos t join clientes c on c.id = t.cliente_id
 where t.guia_despacho ilike '%ANULADO%'
 order by t.numero;
```

**2. Una entrega equivocada (más unidades, otro trabajo, número de documento errado).**
- Si a esa línea **aún le quedan unidades en el taller**, se ve en Taller: gestión la abre, elige **"Desde: Entregado (N)"**, "Pasar a: Listo" y la cantidad → "Mover". Las unidades vuelven a estar listas para entregarse bien. Operarios y choferes no tienen esta opción (la base también lo impide).
- Si la línea ya estaba **entregada completa**, ya no aparece en Taller. Devuélvela a "listo" desde el SQL Editor (cambia `<N>`, `'<producto>'` y `<cantidad>`; queda registrado a nombre de un administrador):
  ```sql
  insert into movimientos (linea_id, cantidad, etapa_origen_id, etapa_destino_id, usuario_id)
  select l.id, <cantidad>,
         (select e.id from etapas e where e.area = t.area and e.es_final order by e.orden limit 1),
         (select e.id from etapas e where e.area = t.area and e.es_listo order by e.orden limit 1),
         (select p.usuario_id from perfiles p where p.rol = 'admin' limit 1)
    from lineas l join trabajos t on t.id = l.trabajo_id
   where t.numero = <N> and l.producto = '<producto>';
  ```
  La base no deja devolver más unidades de las que están entregadas.
- El número de documento ya anotado en la guía de despacho **no lo puede cambiar el chofer** (solo agregar números). Gestión lo corrige en Table Editor → `trabajos` → `guia_despacho`.

## Lo que NUNCA se ha probado contra un Supabase real

Trata esto como lista de verificación del primer día:

1. **Las reglas de acceso (RLS) en la práctica.** Se probaron en PostgreSQL local simulando `auth.uid()` y roles; en Supabase intervienen JWT reales, los roles `anon`/`authenticated` y PostgREST. Los puntos 4, 5, 7, 8, 10, 12, 16, 18 y 19 de la prueba de humo los ejercitan (4: solo gestión escribe en `cliente_recorridos`).
2. **La forma de lo que devuelven `crear_trabajo` y `entregar_unidades` a través de PostgREST** (`rpc`, ahora con la clave de idempotencia y el transporte): la app asume cierta forma de respuesta; solo se probó con simulaciones de `supabase-js`. Puntos 6, 9, 14, 15 y 17.
3. **La entrega en vivo de Realtime** (que el cambio llegue a otro dispositivo y que RLS filtre los eventos). Punto 11.
4. **El tope de filas por consulta (1000 en Supabase).** La app lee por páginas, pero esa paginación solo se probó con simulaciones; sólo se nota con más de 1000 filas (meses de uso). Si "Qué hay listo" o el Reporte parecen "perder" datos antiguos al crecer el uso, sospecha de esto.
5. **El comportamiento de `upsert` al importar** clientes, productos y recorridos de clientes (que actualice por RUT / código / par cliente-recorrido sin duplicar; el de `cliente_recorridos` usa `onConflict: 'cliente_id,recorrido_id'` y lee la tabla ordenada por esas dos columnas), y el upsert de visitas extra sin nota (que no borre la nota anterior). Puntos 3 y 13. También **"Cliente nuevo" con RLS real** (inserción de gestión y chofer, RUT repetido traducido): punto 7.
6. **Las migraciones en el motor de Supabase** (versión de Postgres, extensiones, publicación `supabase_realtime`): probadas en PostgreSQL 16 local con stubs.
7. **Instalación real en iPhone (Safari) y en un celular físico.** Solo se verificó con Chromium automatizado que el manifest, los íconos y el service worker existen y cargan.
8. **El despliegue en Cloudflare Pages / Vercel** y la configuración de variables.
