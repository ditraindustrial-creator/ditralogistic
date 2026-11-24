import type { Area, Cliente, Etapa, Modalidad } from './tipos'

export const AREAS: readonly Area[] = ['afilado', 'encuadernacion']
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
