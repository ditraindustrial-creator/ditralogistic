import { normalizarRut, type ClienteImportado, type ProductoImportado } from './csv'
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
