import { normalizarRut, rutValido, type ClienteImportado, type ProductoImportado } from './csv'
import type { Cliente, Producto } from './tipos'

export interface Plan<T> {
  nuevos: T[]
  /** Solo filas que cambian algo; `cambios` trae únicamente lo que el archivo informó. */
  actualizaciones: { id: string; cambios: T }[]
  /** Filas del archivo que ya están guardadas tal cual. */
  sinCambios: number
}

function difiere<T extends object>(existente: object, cambios: T): boolean {
  const e = existente as Record<string, unknown>
  return Object.entries(cambios).some(([k, v]) => v !== undefined && e[k] !== v)
}

/**
 * Reparte los clientes importados entre nuevos, actualizaciones y sin cambios, comparando por RUT
 * normalizado (el RUT guardado puede venir en otro formato). Re-importar el mismo archivo no
 * duplica ni reescribe nada. Los cambios solo traen lo que el archivo informó, así que no pisan
 * el recorrido ni datos que el archivo no tiene.
 */
export function planificarClientes(existentes: Cliente[], entrantes: ClienteImportado[]): Plan<ClienteImportado> {
  const porRut = new Map(existentes.map((c) => [normalizarRut(c.rut), c]))
  const plan: Plan<ClienteImportado> = { nuevos: [], actualizaciones: [], sinCambios: 0 }
  for (const c of entrantes) {
    const actual = porRut.get(normalizarRut(c.rut))
    if (!actual) plan.nuevos.push(c)
    else if (difiere(actual, c)) plan.actualizaciones.push({ id: actual.id, cambios: c })
    else plan.sinCambios++
  }
  return plan
}

/** Igual que planificarClientes, por código de producto. */
export function planificarProductos(existentes: Producto[], entrantes: ProductoImportado[]): Plan<ProductoImportado> {
  const porCodigo = new Map(existentes.map((p) => [p.codigo, p]))
  const plan: Plan<ProductoImportado> = { nuevos: [], actualizaciones: [], sinCambios: 0 }
  for (const p of entrantes) {
    const actual = porCodigo.get(p.codigo)
    if (!actual) plan.nuevos.push(p)
    else if (difiere(actual, p)) plan.actualizaciones.push({ id: actual.id, cambios: p })
    else plan.sinCambios++
  }
  return plan
}

// ---- Cliente nuevo (Recepción) ----

/** Datos del formulario "Cliente nuevo". */
export interface ClienteNuevo {
  nombre: string
  rut: string
  contacto?: string
  direccion?: string
  recorridoId?: string | null
}

/** Error de regla de negocio al crear un cliente; el mensaje está en español y se muestra tal cual. */
export class ErrorCliente extends Error {
  constructor(mensaje: string) {
    super(mensaje)
    this.name = 'ErrorCliente'
  }
}

export const TEXTO_CLIENTE_MAXIMO = 200
export const RUT_DUPLICADO = 'Ya existe un cliente con ese RUT. Búscalo por nombre o RUT en vez de crearlo de nuevo.'

/**
 * Valida un cliente nuevo con las mismas reglas de RUT que el importador (normalizarRut + forma
 * 12345678-5). Devuelve el cliente listo para guardar (RUT normalizado, textos sin espacios
 * sobrantes, vacíos omitidos) y la lista de errores en español (vacía si se puede guardar).
 * Con `existentes` avisa del RUT repetido antes de ir a la base.
 */
export function validarClienteNuevo(
  datos: ClienteNuevo,
  existentes: Cliente[] = [],
): { cliente: Omit<Cliente, 'id'>; errores: string[] } {
  const errores: string[] = []
  const nombre = datos.nombre.trim()
  const rutCrudo = datos.rut.trim()
  const rut = normalizarRut(rutCrudo)
  if (nombre === '') errores.push('Escribe el nombre del cliente.')
  else if ([...nombre].length > TEXTO_CLIENTE_MAXIMO) errores.push(`El nombre puede tener hasta ${TEXTO_CLIENTE_MAXIMO} caracteres.`)
  if (rutCrudo === '') errores.push('Escribe el RUT.')
  else if (!rutValido(rut)) errores.push(`El RUT "${rutCrudo}" no es válido. Escríbelo así: 12.345.678-5.`)
  else if (existentes.some((c) => normalizarRut(c.rut) === rut)) errores.push(RUT_DUPLICADO)
  const cliente: Omit<Cliente, 'id'> = { nombre, rut, recorridoId: datos.recorridoId || null }
  for (const campo of ['contacto', 'direccion'] as const) {
    const v = datos[campo]?.trim()
    if (!v) continue
    if ([...v].length > TEXTO_CLIENTE_MAXIMO) {
      errores.push(`${campo === 'contacto' ? 'El contacto' : 'La dirección'} puede tener hasta ${TEXTO_CLIENTE_MAXIMO} caracteres.`)
    }
    cliente[campo] = v
  }
  return { cliente, errores }
}
