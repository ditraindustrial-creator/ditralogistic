# Diseño: App de trazabilidad para taller de afilado y encuadernación

Fecha: 2026-11-24 · Estado: BORRADOR para aprobación

## 1. Intención y por qué

La empresa vende herramientas de corte para la industria gráfica (cuchillos, discos, accesorios de guillotina) y tiene dos áreas de servicio:

- **Servicio técnico de afilado**: el cliente entrega cuchillos y herramientas, se reafilan y se devuelven.
- **Encuadernación**: anillado doble cero, espiral plástico, despuntados, calendarios con colgador, etc.

Hoy todo es papel, cuaderno y preguntar en el taller. **No hay trazabilidad**: nadie sabe sin ir a preguntar qué hay en bodega de un cliente, qué está listo ni a qué hora quedó listo.

La app debe dar visibilidad de ese estado en tiempo real, usada desde celular o tablet por choferes, operarios de afilado, operarios de encuadernación y administración. El dueño no quiere dirigir cada paso del proceso: quiere que la gente lo defina y lo siga sola. Se construye en código (no AppSheet) y el mantenimiento futuro se hace 100% con IA, sin equipo técnico interno.

**Éxito = poder responder en cinco segundos, sin ir al taller:**
1. ¿Qué hay del cliente X en bodega? ¿Hay algo listo para retirar?
2. ¿Qué día y en qué recorrido va cada trabajo? ¿Está listo o no?
3. En encuadernación: ¿cuánto hay listo, de qué cliente y a qué hora quedó listo? Incluye entregas parciales.

## 2. Metas, no metas y antimetas

**Metas (versión 1)**
- Registrar trabajos por **lote de cliente**, con varias líneas (tipo de herramienta o trabajo + cantidad).
- Seguir el avance **por línea y por cantidad** ("4 de 6 listas"), con hora de cada cambio y quién lo hizo.
- Cubrir las tres modalidades de entrada/salida: el cliente lleva y retira, encomienda de regiones (por pagar), y recorrido propio en camioneta.
- Hoja de ruta de choferes dentro de la app, con retiros y entregas por cliente.
- Reporte diario automático de encuadernación (reemplaza el cuaderno).
- Etapas del proceso editables por la empresa, sin tocar código.

**No metas (versión 1)**
- Integración con Ramaflex ERP, incluida la exportación a Excel de trabajos terminados para facturar (**segunda etapa**, junto con la plantilla de carga de Ramaflex).
- Emitir guías de despacho o facturas (las sigue emitiendo Ramaflex).
- Seguimiento por pieza individual (con QR o serie).
- Modo sin conexión (los choferes tienen buena señal).
- Portal o acceso para clientes.
- GPS o seguimiento de camionetas.
- Inventario de productos de venta, cobranza o pagos.

**Antimetas (fracaso aunque "funcione")**
- Que registrar en la app tome más tiempo o más campos que el papel actual.
- Que un operario necesite capacitación larga o tenga que buscar en menús profundos.
- Que sin Claude no se pueda operar el día a día (solo los cambios dependen de él).

## 3. Restricciones

- Usuarios: choferes, operarios de afilado, operarios de encuadernación, jefe de taller, secretaria/administración. Acceso desde celular o tablet, interfaz simple y rápida (botones grandes, pocos pasos).
- Choferes con buena señal en Santiago.
- Ramaflex solo acepta cargas por Excel (sin API). Se necesitará una plantilla de ejemplo para la exportación (fase posterior).
- Sin personal de TI: la solución debe mantenerse con poco esfuerzo.
- Las cuentas (Supabase, hosting, dominio) deben quedar a nombre de la empresa.

## 4. Enfoques considerados

- **A. App web instalable (PWA) + Supabase en la nube. ELEGIDO por el dueño.** Usuarios y permisos incluidos, cambios en vivo, respaldos automáticos, costo bajo. Desventaja: depende de un servicio externo.
- B. Servidor propio (Python + base de datos en VPS). Más control, pero alguien debe mantener respaldos, seguridad y actualizaciones. Descartado por no haber equipo técnico.
- C. Google Sheets como base + pantalla propia. Aprovecha lo hecho en AppSheet, pero es frágil con varios usuarios escribiendo y entregas parciales. Descartado.

## 5. Diseño

*Las decisiones marcadas como **[mi decisión]** son del diseñador, no del dueño. Todo lo demás viene de lo conversado.*

### 5.1 Tecnología [mi decisión]
- Frontend: React + TypeScript + Vite, estilos con Tailwind, instalable como PWA (ícono en la pantalla del celular).
- Backend: Supabase (Postgres, autenticación por usuario, reglas de acceso por rol, actualizaciones en vivo).
- Hosting del frontend: Cloudflare Pages o Vercel (plan gratuito).
- Idioma de la interfaz: español de Chile.

### 5.2 Modelo de datos
- **clientes**: nombre, RUT, contacto, dirección, **recorrido y día asignados** (para saber cuándo les toca la camioneta).
- **recorridos**: nombre, día de la semana, camioneta asignada. Hay dos camionetas diarias de lunes a viernes y una de emergencia para urgentes.
- **trabajos** (el lote de un cliente): cliente, área (afilado o encuadernación), modalidad de entrada, modalidad de salida, fecha y hora de recepción, referencias de documento (guía de retiro, guía de despacho, factura: texto libre), transporte de encomienda si aplica (empresa y número), marca de urgente, notas.
- **lineas**: trabajo, tipo de herramienta o trabajo (texto con sugerencias desde un catálogo editable), cantidad total, y nota opcional (por ejemplo "70 cm").
- **etapas**: área, orden, nombre. Editables por el administrador. Valores iniciales propuestos [mi decisión]:
  - Afilado: Recibido → En taller → Afilado → Listo (en bodega) → Entregado.
  - Encuadernación: Recibido → En producción → Terminado (almacenado) → Entregado.
- **movimientos** (registro de todo lo que pasa): línea, cantidad movida, etapa origen, etapa destino, usuario, fecha y hora. El estado actual de una línea se calcula a partir de los movimientos (cuántas unidades hay en cada etapa), lo que da trazabilidad y soporta entregas parciales sin lógica especial.
- **usuarios** con roles: administrador, secretaria, chofer, operario (afilado), operario (encuadernación), jefe de taller.

### 5.3 Pantallas
1. **Qué hay listo** (pantalla principal): por cliente, cantidades listas vs. totales, hora en que quedó listo, recorrido y día de entrega. Filtro por área, cliente, recorrido y día.
2. **Recepción**: crear un trabajo (cliente, modalidad, líneas con tipo y cantidad). Pensado para hacerse en 30 segundos.
3. **Taller (afilado) y Producción (encuadernación)**: lista de líneas en curso; el operario toca una línea y mueve N unidades a la etapa siguiente.
4. **Ruta de mañana**: lo que está listo por recorrido, para que choferes y secretaria preparen la carga y los documentos (reemplaza el listado a mano).
5. **Hoja de ruta del chofer**: paradas por cliente con lo que se retira y lo que se entrega; el chofer marca cada parada, registra cantidades entregadas o retiradas y puede crear el retiro directamente como nuevo trabajo.
6. **Reporte diario de encuadernación**: listo, en producción y por entregar, con horas. Se genera solo; el jefe lo ve e imprime si quiere.
7. **Administración**: clientes, recorridos, etapas, catálogo de herramientas, usuarios.

### 5.4 Permisos [mi decisión]
- Chofer: ve su hoja de ruta, marca paradas, crea retiros.
- Operarios: ven y mueven trabajos de su área.
- Jefe de taller y secretaria: ven y editan todo lo operativo, y generan reportes y exportaciones.
- Administrador: además gestiona usuarios, etapas y catálogos.

### 5.5 Fases de entrega
1. Base: clientes, recorridos, recepción, líneas, etapas, movimientos, pantalla "Qué hay listo".
2. Taller y producción para ambas áreas.
3. Ruta de mañana y hoja de ruta del chofer.
4. Reporte diario de encuadernación.
5. Ajustes con uso real.

**Segunda etapa (después de la versión 1):** integración con Ramaflex ERP mediante exportación a Excel de trabajos terminados para facturar, usando la plantilla de carga de Ramaflex (se necesitará un archivo de ejemplo con datos de prueba). Aquí también se evalúa el WhatsApp automático de confirmación de visitas.

## 6. Lo que se deja al constructor
Detalles visuales, nombres exactos de campos, estructura de carpetas, pruebas, y los textos de la interfaz, siempre priorizando pocos pasos y botones grandes.

## 7. Respuestas del dueño y pendientes

**Resuelto: prueba de entrega.** La prueba de entrega es el documento de Ramaflex (guía de despacho o factura) firmado en papel por quien recibe. La app NO incluye firma digital. El chofer marca "entregado" y anota el número de documento. La app guarda solo ese número; no hay foto del documento firmado: la prueba es el papel.

**Resuelto: avisos de retiro.** La mayoría de los recorridos se hacen sin aviso: los sectores están asignados y las imprentas están cerca, así que el chofer pasa y registra en el lugar lo que retira. A veces el cliente pide una visita o llegada. En recorridos lejanos se pregunta el día antes por WhatsApp si hay retiro, y el cliente confirma.

Consecuencias en el diseño:
- [mi decisión] Cada parada de la hoja de ruta tiene un campo **"visita confirmada"** (sí / no / sin respuesta), que la secretaria marca a mano en la versión 1. Las paradas de recorridos lejanos se marcan como "requiere confirmación". Los clientes también pueden pedir una visita fuera de su día: se agrega una parada extra a la ruta.
- **Fase posterior (no en la versión 1):** envío automático por WhatsApp del día antes preguntando si hay retiro, y que la respuesta actualice la parada. Requiere la API oficial de WhatsApp Business (con costo por mensaje y plantillas aprobadas por Meta) y se evalúa una vez que la versión 1 esté en uso.

**Etapas.** Sin respuesta del dueño: se parte con las etapas propuestas en 5.2 y se ajustan en la app con el uso real. [mi decisión]

**Pendientes:** ninguno que bloquee la aprobación.
