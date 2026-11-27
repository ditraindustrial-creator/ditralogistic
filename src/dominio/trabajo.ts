import type { Area, Cliente, Etapa, Linea, Modalidad, Movimiento, Trabajo } from './tipos'

export const AREAS: readonly Area[] = ['afilado', 'encuadernacion']

/** Código que ve el usuario: letra del área y su correlativo con tres cifras (A-001, E-012, A-1234). */
export function codigoTrabajo(t: { area: Area; numeroArea: number }): string {
  return `${t.area === 'afilado' ? 'A' : 'E'}-${String(t.numeroArea).padStart(3, '0')}`
}

/**
 * ¿La búsqueda es el código del trabajo? `q` viene en minúsculas, sin espacios ni guiones. Acepta
 * «a001», «a1» o solo el número («1», que coincide en las dos áreas).
 */
export function coincideCodigo(t: { area: Area; numeroArea: number }, q: string): boolean {
  const m = /^([ae])?0*(\d+)$/.exec(q)
  if (!m) return false
  if (m[1] && m[1] !== (t.area === 'afilado' ? 'a' : 'e')) return false
  return Number(m[2]) === t.numeroArea
}

/** Del más reciente al más antiguo (fecha de recepción; a igual fecha, el número interno mayor). */
export function masRecientePrimero(a: { recibidoEn: string; numero: number }, b: { recibidoEn: string; numero: number }): number {
  return Date.parse(b.recibidoEn) - Date.parse(a.recibidoEn) || b.numero - a.numero
}
export const MODALIDADES: readonly Modalidad[] = ['cliente', 'encomienda', 'ruta_propia']
/** Mayor cantidad que acepta la base (integer). */
export const CANTIDAD_MAXIMA = 2147483647

export interface LineaNueva {
  producto: string
  cantidad: number
  nota?: string
}

export interface DatosTrabajoNuevo {
  clienteId: string
  area: Area
  entrada: Modalidad
  /** Por defecto, igual que la entrada. */
  salida?: Modalidad
  urgente?: boolean
  guiaRetiro?: string
  notas?: string
  lineas: LineaNueva[]
}

/** Mensaje cuando la clave de una recepción ya se usó en otra sesión. Igual que en la base (0008). */
export const RECEPCION_CLAVE_USADA = 'Esta recepción no se pudo guardar. Cierra el formulario, ábrelo de nuevo e inténtalo otra vez.'

/** Error de regla de negocio al crear un trabajo; el mensaje está en español y se muestra tal cual. */
export class ErrorTrabajo extends Error {
  constructor(mensaje: string) {
    super(mensaje)
    this.name = 'ErrorTrabajo'
  }
}

export function cantidadValida(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= CANTIDAD_MAXIMA
}

/** Lista de errores (en español) de un trabajo nuevo; vacía si se puede guardar. */
export function validarTrabajoNuevo(datos: DatosTrabajoNuevo): string[] {
  const errores: string[] = []
  if (!datos.clienteId) errores.push('Elige el cliente.')
  if (!AREAS.includes(datos.area)) errores.push('Elige el área (afilado o encuadernación).')
  if (!MODALIDADES.includes(datos.entrada)) errores.push('Elige cómo llegó el trabajo.')
  if (datos.salida !== undefined && !MODALIDADES.includes(datos.salida)) errores.push('La modalidad de salida no es válida.')
  if (datos.lineas.length === 0) errores.push('Agrega al menos una línea.')
  datos.lineas.forEach((l, i) => {
    if (l.producto.trim() === '') errores.push(`La línea ${i + 1} necesita un producto.`)
    if (!cantidadValida(l.cantidad)) {
      errores.push(`La cantidad de la línea ${i + 1} debe ser un número entero mayor que cero.`)
    }
  })
  return errores
}

/** Primera etapa del área (menor orden), que es donde se recibe todo trabajo. */
export function primeraEtapa(etapas: Etapa[], area: Area): Etapa | undefined {
  let primera: Etapa | undefined
  for (const e of etapas) if (e.area === area && (!primera || e.orden < primera.orden)) primera = e
  return primera
}

/** Texto de un campo de cantidad → entero positivo, o NaN si no lo es. */
export function parsearCantidad(texto: string): number {
  const t = texto.trim()
  return /^[0-9]{1,10}$/.test(t) ? Number(t) : NaN
}

function plano(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}
const compacto = (s: string) => plano(s).replace(/[^0-9a-z]/g, '')

/**
 * Sugerencias para el selector de cliente: por nombre (todas las palabras, sin importar
 * mayúsculas ni tildes) o por RUT (con o sin puntos y guion). Los que empiezan con el texto
 * van primero. Texto vacío no sugiere nada. Se filtra en memoria: la lista puede tener miles.
 */
export function filtrarClientes(clientes: Cliente[], texto: string, limite = 8): Cliente[] {
  const q = plano(texto).trim().replace(/\s+/g, ' ')
  if (q === '') return []
  const palabras = q.split(' ')
  const qRut = compacto(q)
  const primeros: Cliente[] = []
  const otros: Cliente[] = []
  for (const c of clientes) {
    const nombre = plano(c.nombre)
    const rut = compacto(c.rut)
    const porNombre = palabras.every((p) => nombre.includes(p))
    const porRut = qRut !== '' && rut.includes(qRut)
    if (!porNombre && !porRut) continue
    ;(nombre.startsWith(q) || (porRut && rut.startsWith(qRut)) ? primeros : otros).push(c)
  }
  return [...primeros, ...otros].slice(0, limite)
}

// ---- Edición de un trabajo mientras sigue en Recepción ----

/** Una línea al editar: con `id` es una línea que ya existe; sin `id`, una línea nueva. */
export interface LineaEditada extends LineaNueva {
  id?: string
}

/** Lo que se puede cambiar de un trabajo mientras ninguna pieza pasó al taller. El área no cambia. */
export interface DatosEdicionTrabajo {
  clienteId: string
  urgente?: boolean
  guiaRetiro?: string
  notas?: string
  lineas: LineaEditada[]
}

/** Mensaje cuando alguna pieza del trabajo ya salió de Recepción. Igual que en la base (0011). */
export const TRABAJO_YA_EN_TALLER = 'Este trabajo ya tiene piezas en el taller: ya no se puede editar desde Recepción.'

/** Errores (en español) de una edición; vacía si se puede guardar. Mismas reglas que un trabajo nuevo. */
export function validarEdicionTrabajo(datos: DatosEdicionTrabajo): string[] {
  const errores: string[] = []
  if (!datos.clienteId) errores.push('Elige el cliente.')
  if (datos.lineas.length === 0) errores.push('Agrega al menos una línea.')
  const ids = new Set<string>()
  datos.lineas.forEach((l, i) => {
    if (l.producto.trim() === '') errores.push(`La línea ${i + 1} necesita un producto.`)
    if (!cantidadValida(l.cantidad)) {
      errores.push(`La cantidad de la línea ${i + 1} debe ser un número entero mayor que cero.`)
    }
    if (l.id !== undefined) {
      if (ids.has(l.id)) errores.push(`La línea ${i + 1} está repetida.`)
      ids.add(l.id)
    }
  })
  return errores
}

/**
 * ¿Sigue el trabajo entero en Recepción? Sí cuando todos los movimientos de sus líneas son la
 * recepción inicial (sin etapa de origen): ninguna pieza se movió al taller ni se entregó.
 */
export function sigueEnRecepcion(trabajoId: string, lineas: Linea[], movimientos: Movimiento[]): boolean {
  const ids = new Set(lineas.filter((l) => l.trabajoId === trabajoId).map((l) => l.id))
  return movimientos.every((m) => !ids.has(m.lineaId) || m.etapaOrigenId === null)
}

/** Trabajos que todavía se pueden editar desde Recepción, del más reciente al más antiguo. */
export function trabajosEnRecepcion(trabajos: Trabajo[], lineas: Linea[], movimientos: Movimiento[]): Trabajo[] {
  const conMovimiento = new Set<string>()
  const lineaATrabajo = new Map(lineas.map((l) => [l.id, l.trabajoId]))
  for (const m of movimientos) {
    if (m.etapaOrigenId !== null) {
      const t = lineaATrabajo.get(m.lineaId)
      if (t) conMovimiento.add(t)
    }
  }
  return trabajos.filter((t) => !conMovimiento.has(t.id)).sort(masRecientePrimero)
}
