# Trazabilidad del taller (afilado y encuadernación)

App web instalable en el celular (PWA), en español de Chile, para saber **sin ir al taller** qué hay de cada cliente, qué está listo, en qué recorrido va y a qué hora quedó listo. Reemplaza el papel y el cuaderno.

Este documento tiene dos partes: **A. Para el dueño** (sin tecnicismos) y **B. Para el asistente de IA** que mantenga el código.

---

# A. Para el dueño

## Qué hace

Cada vez que llegan herramientas (cuchillos, discos, accesorios de guillotina) o un trabajo de encuadernación, se registra un **trabajo** del cliente con sus **líneas** (qué y cuántas). A medida que avanza, el taller mueve **unidades** de una etapa a la siguiente (Recibido → En taller → Afilado → Listo → Entregado; o Recibido → En producción → Terminado → Entregado). Se puede entregar a medias ("4 de 6 listas"). Todo queda con **quién lo hizo y a qué hora**, y lo que se ve en pantalla se actualiza solo.

### Las tres formas de operar (modalidades)
Cada trabajo tiene una modalidad de **entrada** y una de **salida**:
1. **Cliente lleva y retira**: el cliente trae sus herramientas al taller y viene a buscarlas.
2. **Encomienda**: clientes de regiones; se envían por transporte (por pagar).
3. **Recorrido propio**: nuestras camionetas pasan por el cliente según su día de recorrido, retiran y entregan.

### Quién usa qué

| Pantalla | Para qué sirve | Quién la ve |
|---|---|---|
| **Qué hay listo** (pantalla de inicio) | Por cliente: unidades listas vs. totales, desde qué hora, recorrido y día | Administrador, secretaria, jefe de taller, operarios |
| **Recepción** | Crear un trabajo (cliente, modalidad, líneas) en unos 30 segundos; "Cliente nuevo" si el cliente aún no existe | Administrador, secretaria, jefe de taller, **chofer** (para registrar retiros en terreno) |
| **Taller / Producción** | El operario toca una línea y mueve N unidades a la etapa siguiente | Administrador, secretaria, jefe de taller, **operarios** (cada uno solo ve su área) |
| **Ruta de mañana** | Lo que está listo por recorrido, para preparar la carga y los documentos; todos los clientes del recorrido ("Pasar a retirar"); confirmar visitas; despachar encomiendas (con transporte) | Administrador, secretaria, jefe de taller, chofer |
| **Hoja de ruta** (inicio del chofer) | Paradas del día: el chofer marca la visita, registra retiros y **entrega con el número de documento** | Administrador, secretaria, jefe de taller, chofer |
| **Reporte diario** | Encuadernación: listo hoy, en producción y por entregar, con horas; se imprime | Administrador, secretaria, jefe de taller |
| **Administración** | Clientes (importar desde Excel y asignar recorrido), recorridos, productos | Solo administrador |

Roles disponibles: `admin`, `secretaria`, `jefe_taller`, `chofer`, `operario_afilado`, `operario_encuadernacion`.

## Cómo se pone en marcha por primera vez
Sigue paso a paso **[docs/puesta-en-marcha.md](docs/puesta-en-marcha.md)**. Incluye cómo crear el proyecto en Supabase, aplicar las migraciones, crear usuarios, publicar la app, instalarla en el celular y una **prueba de humo de 22 puntos**. Resumen de la lista:

1. Crear el proyecto en Supabase (cuenta de la empresa).
2. Aplicar las 8 migraciones de `supabase/migrations/` en orden (SQL Editor).
3. Comprobar que Realtime está activo para `movimientos`.
4. Crear al primer administrador (usuario en Authentication + `supabase/seed/primer_admin.sql`) y **desactivar "Allow new users to sign up"** en Authentication (nadie puede crearse una cuenta solo).
5. Copiar la URL y la clave **anon** del proyecto.
6. Publicar en Cloudflare Pages (o Vercel) con esas dos variables.
7. Abrir en el celular e instalar en la pantalla de inicio.
8. Crear a los demás usuarios.
9. Hacer la prueba de humo con datos de práctica, y borrarlos.

> **Aviso honesto:** la app nunca se ha probado contra un Supabase real (solo contra una base local simulada). El primer arranque es una prueba de verificación; la lista de lo no probado está al final de `docs/puesta-en-marcha.md`. Los nombres de menús de Supabase y Cloudflare en las guías se escribieron de memoria y pueden haber cambiado: busca la opción equivalente.

## Cómo corregir un error
La app **no tiene "anular"** ni borra nada: todo queda en el historial con quién y cuándo. Solo **gestión** (secretaria, jefe de taller, administrador) corrige:
- **Trabajo recibido con cantidad o cliente equivocado:** en Taller pasar todas sus unidades a "Listo" y usar **"Entregar…"** con el documento **`ANULADO`**; luego recibirlo bien. El trabajo queda como entregado completo con guía `ANULADO`, sale de las listas y **no se puede deshacer**; en el Reporte diario de ese día esas unidades cuentan como "listo hoy".
- **Entrega equivocada:** si a la línea le quedan unidades en el taller, gestión la abre en Taller y elige **"Desde: Entregado"** → "Pasar a: Listo". Si ya se entregó completa, hay un SQL de corrección en `docs/puesta-en-marcha.md`. Operarios y choferes no pueden sacar unidades de "Entregado" (la base lo impide). El chofer tampoco puede cambiar ni borrar un número de guía ya anotado, solo agregar.

Para listar los trabajos anulados (SQL Editor de Supabase):
```sql
select t.numero, c.nombre as cliente, t.recibido_en::date as recibido, t.guia_despacho
  from trabajos t join clientes c on c.id = t.cliente_id
 where t.guia_despacho ilike '%ANULADO%' order by t.numero;
```
Detalle paso a paso en `docs/puesta-en-marcha.md`, sección "Cómo corregir un error".

## Si se corta la señal al guardar
Si el celular pierde la respuesta justo al guardar un trabajo o una entrega, la app muestra un error de conexión. **Vuelve a tocar el mismo botón sin cerrar el formulario**: la app reenvía la misma solicitud y la base reconoce que ya la registró, así no se duplica el trabajo ni se entrega dos veces. Si cierras el formulario y lo abres de nuevo, es una solicitud nueva: revisa antes en "Qué hay listo" o en Taller si ya quedó.

## Crear usuarios
Supabase guarda correo y clave (Authentication → Users). La app además necesita el **rol** de cada persona en la tabla `perfiles`. Procedimiento y plantilla en `supabase/seed/primer_admin.sql` (se ejecuta en el SQL Editor de Supabase). No hay pantalla de usuarios en la app. Para dar de baja a alguien: "Ban user" en Authentication (no borrarlo: su historial lo referencia).

## Cargar tus clientes y productos desde Excel
En **Administración → Clientes** (o **Productos**) elige el archivo y la app te deja indicar qué columna es cada dato.
1. En Excel: Guardar como **CSV UTF-8 (delimitado por comas)**; en Chile Excel suele separar con `;` y la app lo reconoce (también acepta `,` y tabulación, y archivos en Windows-1252).
2. Clientes: columnas de **nombre** y **RUT** (obligatorias), contacto y dirección (opcionales). El RUT es la llave: importar de nuevo actualiza en vez de duplicar. Los RUT con puntos y guion se aceptan.
3. Productos: **código** y **nombre** (obligatorias) y área (opcional; o elige un área para todos).
4. Las filas con problemas se listan con su número de fila, y las buenas igual se importan.

## Lo que la app NO hace (decisiones)
- **No se conecta a Ramaflex ERP** (solo acepta cargas por Excel). Fase 2: exportar a Excel los trabajos terminados para facturar; para eso se necesita un archivo de ejemplo de la plantilla de carga de Ramaflex.
- **No manda WhatsApp automático** de confirmación de visitas. Hoy la secretaria marca a mano si la visita está confirmada. Fase 2 (requiere WhatsApp Business API, con costo por mensaje).
- **Prueba de entrega = el documento firmado en papel.** La app solo guarda el número del documento (guía o factura); no hay firma digital ni foto.
- **No funciona sin internet** (los choferes tienen buena señal). Instalarla en el celular no la habilita sin conexión.
- No emite guías ni facturas, no sigue piezas individuales, no tiene portal para clientes ni GPS.
- **Las etapas no se editan desde la app todavía** (solo por SQL; ver sección B). La pantalla Administración cubre clientes, recorridos y productos; un cliente suelto también se crea desde Recepción ("Cliente nuevo").

## Respaldos
Supabase hace respaldos diarios automáticos **según el plan contratado** (en el plan gratuito no están incluidos; hay que revisarlo): **Project Settings → Database → Backups**. Recomendación: además, una vez al mes, **Table Editor → cada tabla → Export to CSV** (al menos `trabajos`, `lineas`, `movimientos`, `clientes`) y guardar los archivos en el Drive de la empresa. Las cuentas de Supabase y del hosting deben estar a nombre de la empresa, con al menos dos personas con acceso.

## Pedir cambios a un asistente de IA
Dale este repositorio y este README. Pide cosas concretas ("agrega la etapa 'Control de calidad' en afilado"). Antes de aceptar un cambio exige que corran las pruebas (sección B) y, si toca la base de datos, que cree una **migración nueva** (nunca editar las ya aplicadas) y que te explique cómo aplicarla.

---

# B. Para el asistente de IA

## Stack y principios
- Vite + React 19 + TypeScript + Tailwind 4 + vite-plugin-pwa. Backend: Supabase (Postgres, Auth, Realtime). Pruebas: Vitest + Testing Library (jsdom) y pruebas SQL en PostgreSQL local.
- **La lógica de negocio vive en `src/dominio/`** (funciones puras, probadas). Las pantallas (`src/pantallas/`) solo la usan.
- El acceso a datos pasa por la interfaz `Repo` (`src/data/repo.ts`) con dos implementaciones: `supabaseRepo.ts` (real) y `memoryRepo.ts` (pruebas). Un cambio de datos se hace en ambas.
- **El estado de una línea se calcula siempre desde `movimientos`** (cuántas unidades hay en cada etapa). No existe una columna "estado". Mover/entregar unidades se hace solo con las funciones SQL atómicas `mover_unidades` y `entregar_unidades` (bloquean filas y validan cantidades). **Llegar a una etapa final solo es posible por `entregar_unidades`** (marca la transacción con `app.entrega_ok`; `movimientos_validar` rechaza cualquier otro camino, para todos los roles) y salir de una etapa final es solo de gestión (0008).
- **Reintentos idempotentes:** Recepción y el panel de Entrega generan una clave (`src/dominio/clave.ts`) por formulario abierto y la reenvían en cada reintento; `crear_trabajo` la guarda en `trabajos.clave_idempotencia` y `entregar_unidades` en `entregas_registradas`. Misma clave + mismo usuario = devuelve lo ya hecho; otro usuario u otros datos = error en español sin datos ajenos.
- Fechas y horas se calculan en `America/Santiago` (`src/dominio/fechas.ts`, SQL `hoy_chile()`).
- La seguridad real son las políticas **RLS** y los triggers de `supabase/migrations/`. Ocultar una pantalla en `permisos.ts` es solo comodidad.

## Mapa de carpetas
```
src/
  main.tsx, App.tsx        arranque, login, menú por rol
  config.ts                lee VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
  dominio/                 reglas puras + sus .test.ts (avance, listo, taller, trabajo, ruta,
                           entrega, reporte, csv, maestros, permisos, fechas, tipos)
  data/                    repo.ts (interfaz), supabaseRepo.ts, memoryRepo.ts y sus pruebas
  pantallas/               listo/ recepcion/ taller/ ruta/ entrega/ reporte/ admin/ + useDatosEnVivo.ts
supabase/
  migrations/              0001..0008 (esquema, RLS, funciones), se aplican en orden
  tests/                   *.test.sql (pgTAP simulado)
  seed/primer_admin.sql    plantilla para crear el primer admin y otros usuarios
scripts/
  sql-local/               corre migraciones y pruebas SQL en un PostgreSQL local (sin Docker)
  generar-iconos.mjs       (npm run iconos) genera los PNG de public/ desde public/icono.svg
  verificar-pwa.mjs        (npm run verificar-pwa) comprueba manifest, íconos y service worker
  navegador.mjs            ayuda común: abre Chromium con Playwright o explica qué falta
docs/
  puesta-en-marcha.md      checklist de lanzamiento + prueba de humo
  superpowers/specs|plans  diseño y plan originales
.github/workflows/ci.yml   CI: tipos, pruebas y build; pruebas SQL con postgres:16
```

## Correr en local
```bash
npm install
cp .env.example .env       # completar VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY
npm run dev                # http://localhost:5173
```
Sin `.env` la app muestra "Falta configurar la aplicación".

## Pruebas (todo debe pasar antes de entregar un cambio)
```bash
npx tsc --noEmit                  # tipos
npx vitest run                    # todas las pruebas de la app (equivale a npm test)
npm run build                     # tsc + build de producción + service worker
npm run verificar-pwa             # PWA instalable (manifest, íconos, service worker); no es parte de vitest
npm run iconos                    # solo si cambias public/icono.svg: regenera los PNG de public/
```
`verificar-pwa` e `iconos` usan Playwright (devDependency fijada en 1.63.0). **Una sola vez por máquina** hay que bajar su navegador: `npx playwright install chromium`. Si ya existe un Chromium, se puede indicar con `PLAYWRIGHT_CHROMIUM_PATH=/ruta/a/chromium`. Si falta Playwright o el navegador, los scripts terminan con un mensaje en español que dice qué hacer.
Pruebas SQL (PostgreSQL 16 local; ejecutar como usuario con permisos de superusuario):
```bash
su postgres -c "bash scripts/sql-local/correr_pruebas.sh"
```
Crea una base desechable, aplica `supabase/migrations/*.sql` con stubs de auth, corre `supabase/tests/*.test.sql` y tres pruebas de carrera con sesiones paralelas (movimientos, entregas y reintentos con la misma clave). Variables estándar `PG*` y `DB=<nombre>` se respetan. El workflow de GitHub hace lo mismo con un contenedor `postgres:16` (esa parte del CI no se pudo ejecutar localmente: validarla en el primer push).

## Integración continua (GitHub Actions)
`.github/workflows/ci.yml` corre en cada push y pull request. El trabajo **`app`** (tipos, pruebas y build, Node 22) es el que manda: si falla, el cambio está mal. El trabajo **`sql`** (migraciones y pruebas SQL en un contenedor `postgres:16`) está marcado `continue-on-error`: **nunca se ha visto en verde**, así que su primer resultado hay que mirarlo a mano; si pasa, quitar esa línea del workflow para hacerlo bloqueante. Un fallo de `sql` no oculta uno de `app` (son trabajos independientes; revisar cada uno por separado en GitHub).

**Ojo, dueño:** mientras el trabajo `sql` tenga `continue-on-error`, **si falla, GitHub igual muestra el workflow completo en verde** (el ✓ general de la confirmación). Un ✓ verde no garantiza que las pruebas SQL pasaron: abre la ejecución en la pestaña **Actions** y mira el trabajo "Pruebas SQL" por separado (aparece con un aviso o una ✗ propia). Cuando pase en verde por primera vez, pide quitar esa línea para que un fallo vuelva a marcar el workflow en rojo.

## Variables de entorno
| Variable | Valor | Notas |
|---|---|---|
| `VITE_SUPABASE_URL` | `https://<proyecto>.supabase.co` | Se incrusta al construir |
| `VITE_SUPABASE_ANON_KEY` | clave anon/publishable del proyecto | **Pública por diseño**: viaja dentro de la app; la protegen las políticas RLS |

**La clave `service_role` / secret NUNCA va en la app, en `.env`, en el repositorio ni en el hosting del frontend**: se salta toda RLS. `.env` está en `.gitignore`. Al cambiar una variable hay que reconstruir y redesplegar.

## Migraciones
Orden y contenido: ver la tabla en `docs/puesta-en-marcha.md`. Aplicar en Supabase SQL Editor (pegar y ejecutar cada archivo en orden), o con la CLI (`supabase link` + `supabase db push`, no probado aquí: no hay `config.toml`). Reglas: **nunca editar una migración ya aplicada**; todo cambio es un archivo nuevo `0008_...sql` (correlativo) y debe pasar `scripts/sql-local/correr_pruebas.sh`; agregar una prueba en `supabase/tests/` si cambia una regla.

## Cómo cambiar cosas comunes
- **Agregar o renombrar una etapa.** Las etapas son datos (tabla `etapas`: `area, orden, nombre, es_listo, es_final`, único por `(area, orden)`). Renombrar: `update etapas set nombre = '...' where area = 'afilado' and nombre = '...'`. Agregar en el medio exige renumerar `orden` (migración nueva o SQL Editor; hacerlo en un solo `update` con cuidado por la unicidad). `es_listo = true` marca "listo para entregar" (lo que cuenta "Qué hay listo"); `es_final = true` marca "Entregado". La app no tiene el nombre de ninguna etapa escrito en código (se leen de la tabla), salvo textos de ayuda. Tras cambiar: `npx vitest run` y la prueba de humo puntos 10, 11 y 14. No hay pantalla de edición de etapas (el spec la prevé: sería una pestaña nueva en `src/pantallas/admin/Maestros.tsx` + métodos en `Repo`, ambos repos y pruebas).
- **Agregar un rol.** (1) Migración nueva: `alter type rol add value 'nuevo_rol';` (en Postgres, el valor nuevo no se puede usar en la misma transacción: ejecutarlo solo). (2) `src/dominio/tipos.ts` (tipo `Rol`). (3) `src/dominio/permisos.ts` (pantallas del rol y `puedeEntregar`). (4) Las políticas RLS y funciones que nombran roles: `es_gestion()`, `puede_ver_area()` en `0001_esquema.sql`, y las de `0005_recepcion.sql`, `0007_ruta.sql` (`chofer_*`, `entregar_unidades`) y `0008_ajustes_finales.sql` (`movimientos_validar`, `trabajos_limitar_campos`, `crear_trabajo`, `entregar_unidades`); crear una migración que las reemplace. (5) Pruebas: `permisos.test.ts` y un `.test.sql`.
- **Agregar un recorrido.** Sin código: Administración → Recorridos (nombre, día 1-5 = lunes a viernes, camioneta, "lejano" = requiere confirmación el día antes). Luego asignar clientes en la pestaña Clientes.
- **Cambiar o agregar una modalidad** (`cliente`, `encomienda`, `ruta_propia`). Toca: tipo SQL `modalidad` (migración con `alter type modalidad add value`) y las validaciones literales de `crear_trabajo` en `0008_ajustes_finales.sql` (versión vigente; antes `0007_ruta.sql` y `0005_recepcion.sql`), `src/dominio/tipos.ts` (`Modalidad`), `src/dominio/trabajo.ts` y `src/dominio/ruta.ts` (reglas de qué entra a la ruta), `src/pantallas/recepcion/Recepcion.tsx` (`MODALIDADES`), `src/pantallas/ruta/comun.tsx` (etiquetas) y `RutaManana.tsx`. Pruebas en `trabajo.test.ts`, `ruta.test.ts`, `Recepcion.test.tsx`, `ruta.test.sql`.
- **Agregar una pantalla.** Tipo `Pantalla` (`tipos.ts`), permisos (`permisos.ts`), entrada en `PANTALLAS` y renderizado en `App.tsx`, componente en `src/pantallas/<nombre>/`. Controles que no deben imprimirse llevan `print:hidden`.
- **Cambiar el ícono o los colores de la PWA.** Editar `public/icono.svg` y correr `npm run iconos`; el manifest está en `vite.config.ts` (`VitePWA`), los colores `#0f766e` (tema) y `#ffffff` (fondo).

## Decisiones y límites conocidos
- Diseño completo y razones: `docs/superpowers/specs/2026-11-24-trazabilidad-logistica-design.md`. Plan por tareas: `docs/superpowers/plans/2026-11-24-trazabilidad-logistica.md`.
- Sin Ramaflex (fase 2: exportar Excel de trabajos terminados; falta la plantilla de ejemplo), sin WhatsApp (fase 2), sin firma ni foto (la prueba es el papel; solo se guarda el N.º de documento), sin modo sin conexión (el service worker solo cachea la aplicación para instalarla y cargar rápido), sin seguimiento por pieza.
- Sin pantalla de usuarios ni de etapas (se hacen por SQL). Sin "anular" (ver "Cómo corregir un error") ni búsqueda/historial de trabajos entregados (v1.1).
- `cargarTodo()` descarga todo el historial en cada recarga; con meses de datos hará falta cargar incremental o por fecha (diferido a propósito).
- El bundle JS pesa ~520 kB (146 kB comprimido); Vite avisa de tamaño. Es aceptable para uso en celular con buena señal; dividir con `import()` si crece.
- Lecturas paginadas de 1000 en 1000 (tope de PostgREST); todo el historial se descarga al abrir y se recalcula en el cliente. Con mucho volumen (años de movimientos) habrá que filtrar por fecha en el servidor.
- **No verificado**: iOS Safari y teléfono real (solo se comprobó con Chromium automatizado: manifest, íconos 192/512/maskable/apple-touch y service worker); Lighthouse; todo lo que toca un Supabase real (ver lista en `docs/puesta-en-marcha.md`).
