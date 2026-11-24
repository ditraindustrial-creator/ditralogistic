# Trazabilidad de taller (afilado y encuadernación) — Plan de implementación (versión 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** App web instalable (PWA) en español de Chile para seguir lotes de clientes por línea y cantidad, desde recepción hasta entrega, en afilado y encuadernación.

**Architecture:** Frontend React + TypeScript sin lógica de negocio en los componentes: las reglas viven en funciones puras de `src/dominio/` (probadas con Vitest). El acceso a datos pasa por una interfaz `Repo` con dos implementaciones: `supabaseRepo` (real) y `memoryRepo` (pruebas). El estado de cada línea se calcula siempre a partir de `movimientos`; las escrituras que mueven unidades se hacen por una función SQL atómica.

**Tech Stack:** Vite, React 18, TypeScript, Tailwind, Supabase (Postgres, Auth, Realtime, Storage), Vitest + Testing Library, vite-plugin-pwa, Cloudflare Pages.

**Spec:** `docs/superpowers/specs/2026-11-24-trazabilidad-logistica-design.md`

## Global Constraints

- Interfaz en español de Chile, para celular y tablet: botones grandes, pocos pasos; registrar no debe tomar más campos que el papel actual.
- Backend: Supabase (Postgres + autenticación por usuario + reglas de acceso por rol). Hosting: Cloudflare Pages o Vercel. Las cuentas quedan a nombre de la empresa.
- Roles: `admin`, `secretaria`, `chofer`, `operario_afilado`, `operario_encuadernacion`, `jefe_taller`.
- Áreas: `afilado` y `encuadernacion`. Modalidades de entrada y salida: `cliente`, `encomienda`, `ruta_propia`.
- Etapas iniciales — afilado: Recibido → En taller → Afilado → Listo → Entregado; encuadernación: Recibido → En producción → Terminado → Entregado. Editables en la app.
- El avance es por línea y por cantidad; el estado se calcula desde `movimientos` (usuario, fecha y hora en cada uno).
- Sin integración con Ramaflex, sin Excel de facturación, sin firma digital, sin modo sin conexión, sin WhatsApp automático, sin seguimiento por pieza (segunda etapa). Prueba de entrega = documento firmado en papel; solo se guarda el número y una foto opcional.
- Cada cliente tiene un solo recorrido y día fijos. Dos camionetas diarias de lunes a viernes más una de emergencia.
- Horas y días se calculan en `America/Santiago`.

## Review Focus

1. Mover más unidades de las que hay en la etapa de origen, o una cantidad 0, negativa o decimal → error claro, sin cambiar nada (Task 2).
2. Dos operarios mueven la misma línea al mismo tiempo → nunca se asignan más unidades que la cantidad total (Task 2, prueba SQL).
3. Maestros exportados desde Excel en Chile: separador `;`, BOM, acentos, RUT con puntos y guion, campos entre comillas (Task 3).
4. Trabajo recibido cerca de medianoche → cae en el día correcto en hora de Santiago, incluso en cambio de horario (Task 5).
5. Cliente sin recorrido asignado → aparece bajo "Sin recorrido", no desaparece de las vistas (Task 5).

---

## Estructura de archivos

- `supabase/migrations/0001_esquema.sql` — tablas, RLS, función `mover_unidades`, datos iniciales de etapas.
- `supabase/tests/mover_unidades.test.sql` — pruebas pgTAP.
- `src/dominio/tipos.ts` — tipos compartidos. `permisos.ts`, `avance.ts`, `fechas.ts`, `listo.ts`, `ruta.ts`, `reporte.ts`, `csv.ts` — funciones puras (cada una con su `*.test.ts`).
- `src/data/repo.ts` — interfaz `Repo`; `supabaseRepo.ts`; `memoryRepo.ts`.
- `src/pantallas/` — una carpeta por pantalla del spec (§5.3).
- `README.md` — guía de mantenimiento para trabajar con IA.

### Task 1: Proyecto base, esquema, autenticación y roles

**Files:**
- Create: proyecto en `/home/user/trazabilidad` (mover `/home/user/docs` adentro), `src/dominio/tipos.ts`, `src/dominio/permisos.ts`, `src/dominio/permisos.test.ts`, `src/data/repo.ts`, `src/data/memoryRepo.ts`, `src/data/supabaseRepo.ts`, `src/App.tsx`, `supabase/migrations/0001_esquema.sql`

**Interfaces:**
- Produces: tipos `Rol`, `Area`, `Modalidad`, `Pantalla = 'listo'|'recepcion'|'taller'|'ruta'|'hoja_chofer'|'reporte'|'admin'`, `Etapa {id, area, orden, nombre, esListo, esFinal}`, `Linea {id, trabajoId, producto, cantidad, nota?}`, `Movimiento {id, lineaId, cantidad, etapaOrigenId: string|null, etapaDestinoId, usuarioId, creadoEn: string}`, `Trabajo {id, numero, clienteId, area, entrada: Modalidad, salida: Modalidad, recibidoEn, guiaRetiro?, guiaDespacho?, factura?, transporte?, urgente, notas?, fotoDocumento?}`, `Cliente {id, nombre, rut, contacto?, direccion?, recorridoId: string|null}`, `Recorrido {id, nombre, dia: 1|2|3|4|5, camioneta, lejano: boolean}`; `puedeVer(rol: Rol, pantalla: Pantalla): boolean`; interfaz `Repo` (cada tarea siguiente agrega sus métodos aquí y en `memoryRepo`).

- [ ] **Step 1: Crear el proyecto** con Vite (React + TS), Tailwind, Vitest, Testing Library y vite-plugin-pwa; `git init` en `/home/user/trazabilidad` y mover `/home/user/docs` adentro. Verificar con `npx vitest run` (sin pruebas aún) y `npm run build`.
- [ ] **Step 2: Escribir `permisos.test.ts`** con estas aserciones: `puedeVer('chofer','hoja_chofer')` es true y `puedeVer('chofer','admin')` es false; `puedeVer('operario_afilado','taller')` es true y `puedeVer('operario_afilado','reporte')` es false; `puedeVer('jefe_taller','reporte')` y `puedeVer('secretaria','ruta')` son true; solo `admin` ve `admin`.
- [ ] **Step 3: Ejecutar** `npx vitest run src/dominio/permisos.test.ts` → FALLA (función no existe).
- [ ] **Step 4: Implementar `puedeVer`** en `src/dominio/permisos.ts` como tabla rol→pantallas según §5.4 del spec (chofer también ve `recepcion` solo para crear retiros).
- [ ] **Step 5: Ejecutar** la prueba → PASA.
- [ ] **Step 6: Escribir `0001_esquema.sql`** con las tablas del spec §5.2 (`clientes`, `recorridos`, `trabajos`, `lineas`, `etapas`, `movimientos`, `perfiles(usuario_id, nombre, rol)`, `visitas(id, fecha, cliente_id, recorrido_id, confirmada text, requiere_confirmacion bool, solicitada bool, nota)`), RLS por rol según §5.4 y las etapas iniciales con `es_listo` (Listo, Terminado) y `es_final` (Entregado). Aplicarla en un proyecto Supabase de desarrollo.
- [ ] **Step 7: Implementar login** (correo y contraseña de Supabase) y `App.tsx` con menú que solo muestra las pantallas que `puedeVer` permite; `memoryRepo` y `supabaseRepo` con `usuarioActual(): Promise<{id, nombre, rol}>`. Verificar a mano que un usuario `chofer` no ve el menú de admin.
- [ ] **Step 8: Commit** `feat: proyecto base, esquema y roles`.

### Task 2: Avance por cantidad

**Files:**
- Create: `src/dominio/avance.ts`, `src/dominio/avance.test.ts`, `supabase/migrations/0002_mover_unidades.sql`, `supabase/tests/mover_unidades.test.sql`
- Modify: `src/data/repo.ts`, `memoryRepo.ts`, `supabaseRepo.ts`

**Interfaces:**
- Consumes: `Movimiento`, `Etapa` (Task 1).
- Produces: `distribucionPorEtapa(movs: Movimiento[]): Map<string, number>`; `unidadesListas(movs: Movimiento[], etapas: Etapa[]): number`; `validarMovimiento(dist: Map<string, number>, origenId: string, cantidad: number): void` (lanza `ErrorMovimiento` con mensaje en español); `Repo.moverUnidades(lineaId: string, cantidad: number, origenId: string, destinoId: string): Promise<Movimiento>`; función SQL `mover_unidades(p_linea uuid, p_cantidad int, p_origen uuid, p_destino uuid)`.

- [ ] **Step 1: Escribir `avance.test.ts`.** Con 6 unidades recibidas en "En taller" y luego 4 movidas a "Listo": `distribucionPorEtapa` da `{En taller: 2, Listo: 4}` y `unidadesListas` da 4. `validarMovimiento` lanza `ErrorMovimiento` para cantidad 3 desde una etapa con 2 unidades, y para 0, -1 y 1.5; no lanza para 2.
- [ ] **Step 2: Ejecutar** `npx vitest run src/dominio/avance.test.ts` → FALLA.
- [ ] **Step 3: Implementar** las tres funciones: la distribución suma los destinos y resta los orígenes.
- [ ] **Step 4: Ejecutar** → PASA.
- [ ] **Step 5: Escribir `mover_unidades.test.sql`** (pgTAP): mueve 4 de 6 correctamente; mover 3 de las 2 restantes lanza excepción; dos llamadas concurrentes que juntas superan el total nunca dejan una etapa en negativo.
- [ ] **Step 6: Implementar `mover_unidades`** en SQL: bloquea la fila de la línea (`for update`), calcula las unidades disponibles en el origen, lanza excepción si no alcanzan, e inserta el movimiento con `auth.uid()`. Ejecutar `supabase test db` (requiere Docker; si no hay, ejecutar el archivo contra el proyecto de desarrollo) → PASA.
- [ ] **Step 7: Conectar** `Repo.moverUnidades` en ambas implementaciones. Commit `feat: avance por cantidad`.

### Task 3: Maestros e importación de CSV

**Files:**
- Create: `src/dominio/csv.ts`, `src/dominio/csv.test.ts`, `src/pantallas/admin/Maestros.tsx`, `src/pantallas/admin/Maestros.test.tsx`
- Modify: `repo.ts` y sus implementaciones.

**Interfaces:**
- Consumes: `Cliente`, `Recorrido` (Task 1).
- Produces: `parsearCsv(texto: string): Record<string, string>[]`; `normalizarRut(s: string): string` (formato `12345678-5`); `importarClientes(filas: Record<string,string>[], mapeo: {nombre: string; rut: string}): {clientes: Omit<Cliente,'id'|'recorridoId'>[]; errores: {fila: number; motivo: string}[]}`; `Repo.guardarClientes`, `Repo.listarClientes`, `Repo.guardarRecorrido`, `Repo.listarRecorridos`, `Repo.asignarRecorrido(clienteId, recorridoId)`, y lo equivalente para el catálogo de productos (`Producto {id, codigo, nombre, area}`, `importarProductos` con la misma forma).

- [ ] **Step 1: Escribir `csv.test.ts`** con un CSV de Excel chileno: BOM al inicio, separador `;`, `"Imprenta ""Sur"", Ltda."` entre comillas y `Tamaño` con acento → `parsearCsv` devuelve esos valores exactos. `normalizarRut('12.345.678-5')` y `normalizarRut(' 12345678 5 ')` dan `'12345678-5'`. `importarClientes` con una fila sin RUT devuelve error en esa fila y sigue con el resto; dos filas con el mismo RUT reportan duplicado.
- [ ] **Step 2: Ejecutar** `npx vitest run src/dominio/csv.test.ts` → FALLA.
- [ ] **Step 3: Implementar** `csv.ts`; detecta `;` o `,` según la primera línea.
- [ ] **Step 4: Ejecutar** → PASA.
- [ ] **Step 5: Escribir la prueba del componente** `Maestros.test.tsx`: al subir un CSV de clientes y elegir qué columna es nombre y cuál es RUT, se listan los clientes importados y los errores por fila.
- [ ] **Step 6: Implementar `Maestros.tsx`** (clientes, recorridos con día y marca "lejano", asignación de recorrido por cliente, catálogo de productos; importación con selección de columnas). Ejecutar las pruebas → PASAN.
- [ ] **Step 7: Commit** `feat: maestros e importación CSV`.

### Task 4: Recepción de trabajos

**Files:**
- Create: `src/dominio/trabajo.ts`, `src/dominio/trabajo.test.ts`, `src/pantallas/recepcion/Recepcion.tsx`, `Recepcion.test.tsx`
- Modify: `repo.ts` y sus implementaciones.

**Interfaces:**
- Consumes: `Trabajo`, `Linea`, `Etapa`, `Repo.moverUnidades` (Tasks 1-2).
- Produces: `validarTrabajoNuevo(datos: {clienteId: string; area: Area; entrada: Modalidad; lineas: {producto: string; cantidad: number}[]}): string[]` (lista de errores, vacía si es válido); `Repo.crearTrabajo(datos): Promise<Trabajo>` — crea el trabajo y por cada línea un movimiento inicial (origen `null`) hacia la primera etapa del área.

- [ ] **Step 1: Escribir `trabajo.test.ts`:** sin cliente, sin líneas, o con una línea de cantidad 0 → mensajes de error; con una línea de 12 unidades → `[]`.
- [ ] **Step 2: Ejecutar** → FALLA. **Step 3: Implementar** `validarTrabajoNuevo`. **Step 4: Ejecutar** → PASA.
- [ ] **Step 5: Escribir `Recepcion.test.tsx`:** elegir cliente, agregar dos líneas (producto del catálogo + cantidad) y guardar llama a `crearTrabajo` una vez y muestra el número del trabajo; con `memoryRepo`, las unidades quedan en la primera etapa.
- [ ] **Step 6: Implementar `Recepcion.tsx`** con pocos campos (cliente, modalidad, líneas, marca de urgente, guía de retiro opcional) y `crearTrabajo` en ambas implementaciones. Ejecutar → PASA.
- [ ] **Step 7: Commit** `feat: recepción de trabajos`.

### Task 5: Qué hay listo

**Files:**
- Create: `src/dominio/fechas.ts`, `fechas.test.ts`, `src/dominio/listo.ts`, `listo.test.ts`, `src/pantallas/listo/Listo.tsx`, `Listo.test.tsx`

**Interfaces:**
- Consumes: `Trabajo`, `Linea`, `Movimiento`, `Etapa`, `Cliente`, `Recorrido`, `unidadesListas` (Tasks 1-2).
- Produces: `diaLocal(iso: string): string` (`YYYY-MM-DD` en `America/Santiago`); `diaSemana(fecha: string): 1|2|3|4|5|6|7`; `resumenListo(datos: {trabajos: Trabajo[]; lineas: Linea[]; movimientos: Movimiento[]; etapas: Etapa[]; clientes: Cliente[]; recorridos: Recorrido[]}): FilaListo[]` con `FilaListo {trabajoId, clienteNombre, area, listas, total, listoDesde: string|null, recorrido: string|null, dia: number|null}`; `Repo.cargarTodo()` (lo que `resumenListo` necesita).

- [ ] **Step 1: Escribir `fechas.test.ts`:** `diaLocal('2026-11-25T02:30:00Z')` da `'2026-11-24'` (verano de Chile, UTC-3); `diaLocal('2026-07-02T03:30:00Z')` da `'2026-07-01'` (invierno, UTC-4); `diaSemana('2026-11-24')` es 2.
- [ ] **Step 2: Escribir `listo.test.ts`:** un trabajo con 6 unidades de las que 4 están en etapa `esListo` da `listas: 4, total: 6` y `listoDesde` igual a la fecha del último movimiento hacia esa etapa; un trabajo cuyo cliente tiene `recorridoId: null` aparece con `recorrido: null` (no se omite); un trabajo sin unidades listas aparece con `listas: 0`.
- [ ] **Step 3: Ejecutar** `npx vitest run src/dominio` → FALLA. **Step 4: Implementar** `fechas.ts` (con `Intl.DateTimeFormat` y zona `America/Santiago`) y `resumenListo`. **Step 5: Ejecutar** → PASA.
- [ ] **Step 6: Escribir `Listo.test.tsx`:** filtros por área, cliente, recorrido y día; las filas sin recorrido salen bajo el grupo "Sin recorrido".
- [ ] **Step 7: Implementar `Listo.tsx`** (pantalla de inicio; se actualiza en vivo con Realtime en `supabaseRepo`). Ejecutar → PASA.
- [ ] **Step 8: Commit** `feat: pantalla qué hay listo`.

### Task 6: Taller y producción

**Files:**
- Create: `src/pantallas/taller/Taller.tsx`, `Taller.test.tsx`

**Interfaces:**
- Consumes: `distribucionPorEtapa`, `validarMovimiento`, `Repo.moverUnidades`, `puedeVer` (Tasks 1-2).
- Produces: pantalla única `Taller` parametrizada por `area: Area` (afilado o encuadernación, según el rol del usuario; jefe y admin ven ambas).

- [ ] **Step 1: Escribir `Taller.test.tsx`:** con una línea de 6 unidades en "En taller", tocar la línea, elegir "Afilado" y cantidad 4 llama a `moverUnidades(linea, 4, enTaller, afilado)`; pedir 7 muestra el mensaje de `ErrorMovimiento` y no llama al repo; un operario de afilado no ve líneas de encuadernación.
- [ ] **Step 2: Ejecutar** → FALLA. **Step 3: Implementar `Taller.tsx`:** lista de líneas en curso del área; al tocar una, selector de etapa destino (por defecto la siguiente) y cantidad (por defecto todo lo disponible), con botones grandes. **Step 4: Ejecutar** → PASA.
- [ ] **Step 5: Commit** `feat: taller y producción`.

### Task 7: Ruta de mañana y hoja del chofer

**Files:**
- Create: `src/dominio/ruta.ts`, `ruta.test.ts`, `src/pantallas/ruta/RutaManana.tsx`, `src/pantallas/ruta/HojaChofer.tsx`, `HojaChofer.test.tsx`
- Modify: `repo.ts` y sus implementaciones.

**Interfaces:**
- Consumes: `FilaListo`, `diaSemana`, `Recorrido`, `Cliente` (Tasks 1, 5), `Repo.crearTrabajo` (Task 4), `Repo.moverUnidades` (Task 2).
- Produces: `armarRuta(fecha: string, filas: FilaListo[], clientes: Cliente[], recorridos: Recorrido[], visitas: Visita[]): Parada[]` con `Parada {clienteId, clienteNombre, recorridoId, entregar: FilaListo[], confirmada: 'si'|'no'|'sin_respuesta', requiereConfirmacion: boolean, solicitada: boolean}`; `Repo.marcarVisita(visitaId, confirmada)`; `Repo.agregarVisitaExtra(fecha, clienteId, nota)`; `Repo.entregarUnidades(lineaId, cantidad, documento: string): Promise<void>` (mueve a la etapa `esFinal` y guarda `guiaDespacho`); `Repo.subirFotoDocumento(trabajoId, archivo: File)`.

- [ ] **Step 1: Escribir `ruta.test.ts`:** para un martes, `armarRuta` incluye solo los clientes con recorrido de martes y que tengan algo listo, más cualquier cliente con visita solicitada ese día; una parada de un recorrido `lejano` sale con `requiereConfirmacion: true`; un cliente con visita `confirmada: 'no'` sale marcado y no se oculta; clientes sin recorrido no aparecen en la ruta pero sí en la lista de pendientes sin asignar que devuelve `armarRuta`.
- [ ] **Step 2: Ejecutar** → FALLA. **Step 3: Implementar** `armarRuta`. **Step 4: Ejecutar** → PASA.
- [ ] **Step 5: Escribir `HojaChofer.test.tsx`:** el chofer ve sus paradas; entregar 3 de 4 listas con documento "4521" llama a `entregarUnidades(linea, 3, '4521')` y queda 1 pendiente; crear un retiro en la parada llama a `crearTrabajo` con `entrada: 'ruta_propia'`; el botón de foto es opcional (se puede entregar sin foto).
- [ ] **Step 6: Implementar** `RutaManana.tsx` (para secretaria y choferes: listado por recorrido, con marca manual de visita confirmada) y `HojaChofer.tsx`; `entregarUnidades` y `subirFotoDocumento` (bucket `documentos` de Supabase Storage). Ejecutar → PASA.
- [ ] **Step 7: Commit** `feat: ruta de mañana y hoja del chofer`.

### Task 8: Reporte diario de encuadernación

**Files:**
- Create: `src/dominio/reporte.ts`, `reporte.test.ts`, `src/pantallas/reporte/Reporte.tsx`, `Reporte.test.tsx`

**Interfaces:**
- Consumes: `diaLocal`, `FilaListo`, `Movimiento`, `Etapa` (Tasks 1, 5).
- Produces: `reporteDiario(fecha: string, datos: mismo conjunto que resumenListo): {listo: FilaReporte[]; enProduccion: FilaReporte[]; porEntregar: FilaReporte[]}` con `FilaReporte {clienteNombre, trabajoNumero, producto, cantidad, hora: string}` (solo área `encuadernacion`, hora `HH:mm` de Santiago).

- [ ] **Step 1: Escribir `reporte.test.ts`:** una línea que pasó a "Terminado" a las `2026-11-24T13:15:00Z` aparece en `listo` con hora `10:15` el 2026-11-24; una línea aún en "En producción" aparece en `enProduccion`; una línea terminada y no entregada aparece en `porEntregar`; una línea de afilado no aparece; un movimiento a las `2026-11-25T02:30:00Z` cuenta como 2026-11-24.
- [ ] **Step 2: Ejecutar** → FALLA. **Step 3: Implementar** `reporteDiario`. **Step 4: Ejecutar** → PASA.
- [ ] **Step 5: Implementar `Reporte.tsx`** (selector de fecha, vista imprimible con `@media print`; visible para jefe de taller y secretaria) y su prueba de renderizado con `memoryRepo`. Ejecutar → PASA.
- [ ] **Step 6: Commit** `feat: reporte diario de encuadernación`.

### Task 9: Despliegue y guía de mantenimiento

**Files:**
- Create: `README.md`, `.github/workflows/ci.yml` (o equivalente en el hosting elegido)
- Modify: `vite.config.ts` (manifest PWA: nombre, ícono, `display: standalone`)

**Interfaces:**
- Consumes: todo lo anterior.

- [ ] **Step 1: Ejecutar** `npx vitest run` y `npm run build` → todo PASA sin errores.
- [ ] **Step 2: Configurar PWA** y verificar con Lighthouse (categoría PWA instalable) en un celular real o emulado.
- [ ] **Step 3: Escribir `README.md`:** qué hace la app, mapa de carpetas, cómo agregar una etapa o un rol, cómo correr pruebas y migraciones, y variables de entorno (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`), pensado para que una IA pueda hacer cambios futuros con seguridad.
- [ ] **Step 4: Desplegar** en Cloudflare Pages (o Vercel) con las cuentas de la empresa y crear los usuarios iniciales por rol. Prueba de humo: un chofer, un operario y la secretaria hacen un trabajo completo (recepción → taller → listo → ruta → entrega) y el estado se ve en "Qué hay listo".
- [ ] **Step 5: Commit** `chore: despliegue y guía de mantenimiento`.

---

## Auto-revisión

- **Cobertura del spec:** metas de §2 → Tasks 2-8 (lotes y líneas: 4; avance: 2; modalidades: 4 y 7; hoja de ruta: 7; reporte: 8; etapas editables: 3 y 1); permisos §5.4 → Task 1; maestros importables → Task 3; fases §5.5 → orden de tareas. Fuera de alcance (Excel, WhatsApp, firma, offline) no tiene tareas, según el spec.
- **Consistencia de tipos:** `Movimiento`, `Etapa`, `FilaListo` y `Repo.*` se definen una vez (Tasks 1, 2 y 5) y se usan con los mismos nombres después.
- **Proporción:** el plan decide interfaces y pruebas; los cuerpos de las funciones los escribe quien implementa.
