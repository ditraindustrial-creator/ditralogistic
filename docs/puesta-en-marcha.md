# Puesta en marcha: lista de pasos y prueba de humo

Esta guía es para quien lanza la app por primera vez (el dueño, con ayuda de un asistente de IA si lo desea). Cada paso dice **qué debe pasar**. Si algo no coincide, no avances: ve a la sección "Si algo falla".

> **Importante:** hasta hoy esta app **nunca se ha probado contra un Supabase real**. Todo el código y todo el SQL se probaron con una base PostgreSQL local y con datos simulados. Trata el primer arranque como una **prueba de verificación**: hazlo con datos de práctica y borra esos datos antes de usarla de verdad (ver paso 10).

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

**Resultado esperado de cada uno:** "Success. No rows returned". En **Table Editor** aparecen las tablas `perfiles`, `recorridos`, `clientes`, `etapas`, `trabajos`, `lineas`, `movimientos`, `visitas`, `productos`; y la tabla `etapas` trae 9 filas (5 de afilado, 4 de encuadernación).

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

## Parte B. Prueba de humo (15 a 20 minutos, dos dispositivos)

Usa dos aparatos: por ejemplo un celular y un computador, o dos celulares. Los datos que crees son de práctica. Marca cada punto; si uno falla, detente y mira "Si algo falla".

| # | Quién | Qué hacer | Resultado esperado |
|---|---|---|---|
| 1 | Admin | Entrar con correo y clave. | Saluda "Hola, <nombre>". El menú muestra: Recepción, Taller / Producción, Ruta de mañana, Hoja de ruta, Reporte diario, Administración; abajo "Qué hay listo". |
| 2 | Admin | Administración → Recorridos: crear "Lunes Norte" (lunes, camioneta 1). | Aparece en la lista. |
| 3 | Admin | Administración → Clientes: crear/importar clientes. Importa un CSV pequeño de 3 filas (columnas `nombre;rut;contacto;direccion`, separador `;`). Vuelve a importarlo. | La primera vez informa 3 clientes nuevos; la segunda informa 0 nuevos y 3 sin cambios (no duplica). Un RUT repetido o mal escrito aparece como error de esa fila, sin detener las demás. |
| 4 | Admin | Asignar a un cliente el recorrido "Lunes Norte". Importar 3 productos en Productos. | Se guarda y al recargar sigue ahí. |
| 5 | Secretaria | Entrar. Revisar el menú. | Ve todo lo operativo, **sin** Administración. |
| 6 | Secretaria | Recepción: crear un trabajo de afilado para un cliente, con 2 líneas (ej. 6 cuchillos y 4 discos). | Muestra "Trabajo N.º ... guardado"; el trabajo aparece en Taller con todas las unidades en "Recibido". |
| 7 | Chofer | Entrar. | El menú empieza con "Hoja de ruta" y solo tiene Ruta de mañana, Hoja de ruta y Recepción. **No** ve Taller, Reporte ni Administración. |
| 8 | Chofer | Recepción (retiro en terreno): crear un trabajo de encuadernación para un cliente, con 1 línea de 10 unidades. | Se crea; queda como entrada "ruta propia". |
| 9 | Operario de afilado | Entrar. En Taller mover 3 unidades de una línea de "Recibido" a la etapa siguiente; luego 3 hasta "Listo". | Solo ve trabajos de afilado (no los de encuadernación). Intentar mover más unidades de las que hay en la etapa da un mensaje claro y no cambia nada. |
| 10 | Admin en el otro dispositivo | Mantener abierta "Qué hay listo" mientras el operario mueve unidades a "Listo". | **Sin recargar**, en pocos segundos aparece el cliente con "3 de 6 listas" y la hora. (Prueba de Realtime.) |
| 11 | Operario | Revisar el menú y buscar cómo entregar. | Solo ve "Qué hay listo" y "Taller". No hay botón de entrega ni Ruta ni Hoja de ruta. |
| 12 | Secretaria | Ruta de mañana (día siguiente hábil; si es fin de semana, el lunes). | Muestra, agrupado por recorrido, los clientes con lo que está listo; hay una sección "Por encomienda". Se puede marcar la visita confirmada (sí / no / sin respuesta) y agregar una parada extra. |
| 13 | Chofer | Hoja de ruta: abrir la parada del cliente, marcar la visita y **entregar** las 3 unidades listas con un número de documento (ej. `G-1001`). | Pide el N.º de documento (guía o factura) y muestra "Entrega registrada ... Documento G-1001"; "Qué hay listo" ahora muestra 0 listas para ese cliente y el trabajo queda con 3 entregadas, 3 por entregar. |
| 14 | Chofer | Intentar entregar más de lo que hay listo (o dos veces lo mismo, desde dos aparatos). | Mensaje claro; nunca se entrega más de lo listo. |
| 15 | Secretaria | Crear (Recepción) un trabajo con salida "Encomienda", moverlo a "Listo" en Taller y, en Ruta de mañana, sección "Por encomienda", usar "Despachar por encomienda" con un N.º de documento. | Se registra el despacho con el documento; las unidades pasan a Entregado y salen de "Qué hay listo". |
| 16 | Jefe de taller o secretaria | Reporte diario (fecha de hoy). | Muestra secciones Listo hoy / En producción / Por entregar con cantidades y horas coherentes con lo que se hizo. |
| 17 | Cualquiera con acceso | En Reporte diario pulsar **Imprimir** (o Ctrl+P). | La vista previa sale limpia: sin botones "Salir", "Menú" ni "Imprimir". |
| 18 | Operario de encuadernación | Entrar y abrir Taller. | Solo ve trabajos de encuadernación. |
| 19 | Todos | Cerrar sesión y entrar de nuevo; cerrar y reabrir la app instalada. | Vuelve a la sesión o pide clave; nunca muestra datos sin iniciar sesión. |
| 20 | Admin | Revisar **Authentication → Users** y la tabla `movimientos`. | Cada movimiento registra el usuario correcto y la hora. |

**Cierre de la prueba:** borra los datos de práctica (en el SQL Editor: `truncate movimientos, lineas, trabajos, visitas cascade;` y borra a mano los clientes y productos de prueba en Administración o en el Table Editor). Los usuarios reales, las etapas y los recorridos se conservan.

## Si algo falla

**No puedo entrar / "Invalid login credentials".** Revisa el correo y la clave en Authentication → Users; si el usuario figura sin confirmar, ábrelo y confírmalo (o créalo con Auto Confirm).

**Entro, pero la app no muestra nada o dice que no tienes permisos.** Casi seguro falta la fila en `perfiles` (paso 4/8). Comprueba con `select u.email, p.rol from perfiles p join auth.users u on u.id = p.usuario_id;`. Si el correo no aparece, ejecuta de nuevo el insert de `supabase/seed/primer_admin.sql`.

**Mensaje de "permiso denegado" / "row-level security" / "new row violates row-level security policy" al guardar.** Es una regla de acceso (RLS) actuando. Primero verifica que el usuario tenga el rol correcto (arriba). Si el rol es correcto y la acción es legítima, es un **error nuestro**: copia el mensaje completo, indica qué usuario (rol) hacía qué, y entrégaselo al asistente de IA junto con `supabase/migrations/0001_esquema.sql` y `0007_ruta.sql`; las políticas de RLS están ahí. No desactives RLS "para que funcione": dejaría los datos abiertos a cualquiera con la clave pública.

**Lista vacía aunque hay datos (por rol).** Los operarios solo ven su área; los choferes solo lo que corresponde a su ruta. Compara con el rol que corresponde.

**"Qué hay listo" no se actualiza solo.** (1) Repite el paso 3 y confirma que `movimientos` está en la publicación `supabase_realtime`. (2) En Supabase → Project Settings → API / Realtime, confirma que Realtime está habilitado. (3) Mira la consola del navegador del dispositivo (en el computador: F12) por errores de WebSocket; una red de empresa que bloquee WebSockets lo impide. (4) Mientras tanto, recargar la pantalla muestra el dato correcto: el estado real está siempre en la base; solo la actualización en vivo falla.

**Un error al aplicar una migración.** Anota el número de la migración y el mensaje completo. Causas típicas: se ejecutó fuera de orden (`relation ... does not exist`) o se ejecutó dos veces (`already exists`). Si una migración falló a medias, no sigas con la siguiente: lo más simple en un proyecto nuevo y vacío es borrar las tablas y volver a empezar (Project Settings → Database → o crear un proyecto nuevo) y aplicar de nuevo desde la 0001. Entrégale el mensaje al asistente de IA; las migraciones se probaron en PostgreSQL 16 con una simulación de Supabase, así que pueden existir diferencias menores con el real.

**Aparece "Falta configurar la aplicación".** Faltan `VITE_SUPABASE_URL` o `VITE_SUPABASE_ANON_KEY` en el hosting. Agrégalas y vuelve a desplegar.

**La app instalada no se actualiza tras un cambio.** Cierra la app por completo y ábrela dos veces (la actualización se aplica sola al volver a abrir).

## Lo que NUNCA se ha probado contra un Supabase real

Trata esto como lista de verificación del primer día:

1. **Las reglas de acceso (RLS) en la práctica.** Se probaron en PostgreSQL local simulando `auth.uid()` y roles; en Supabase intervienen JWT reales, los roles `anon`/`authenticated` y PostgREST. Los puntos 5, 7, 9, 11 y 18 de la prueba de humo los ejercitan.
2. **La forma de lo que devuelven `crear_trabajo` y `entregar_unidades` a través de PostgREST** (`rpc`): la app asume cierta forma de respuesta; solo se probó con simulaciones de `supabase-js`. Puntos 6, 8, 13 y 15.
3. **La entrega en vivo de Realtime** (que el cambio llegue a otro dispositivo y que RLS filtre los eventos). Punto 10.
4. **El tope de filas por consulta (1000 en Supabase).** La app lee por páginas, pero esa paginación solo se probó con simulaciones; sólo se nota con más de 1000 filas (meses de uso). Si "Qué hay listo" o el Reporte parecen "perder" datos antiguos al crecer el uso, sospecha de esto.
5. **El comportamiento de `upsert` al importar** clientes y productos (que actualice por RUT / código sin duplicar). Punto 3.
6. **Las migraciones en el motor de Supabase** (versión de Postgres, extensiones, publicación `supabase_realtime`): probadas en PostgreSQL 16 local con stubs.
7. **Instalación real en iPhone (Safari) y en un celular físico.** Solo se verificó con Chromium automatizado que el manifest, los íconos y el service worker existen y cargan.
8. **El despliegue en Cloudflare Pages / Vercel** y la configuración de variables.
