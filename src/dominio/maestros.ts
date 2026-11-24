import { normalizarRut, type ClienteImportado, type ProductoImportado } from './csv'
import type { Cliente, Producto } from './tipos'

export interface Plan<TNuevo, TCambios> {
  nuevos: TNuevo[]
  actualizaciones: { id: string; cambios: TCambios }[]
}

/**
 * Reparte los clientes importados entre nuevos y actualizaciones, comparando por RUT normalizado
 * (el RUT guardado puede venir en otro formato). Re-importar el mismo archivo nunca duplica.
 * Los cambios solo traen lo que el archivo informó, así que no pisan el recorrido ni datos que el
 * archivo no tiene.
 */
export function planificarClientes(existentes: Cliente[], entrantes: ClienteImportado[]): Plan<ClienteImportado, ClienteImportado> {
  const porRut = new Map(existentes.map((c) => [normalizarRut(c.rut), c.id]))
  const plan: Plan<ClienteImportado, ClienteImportado> = { nuevos: [], actualizaciones: [] }
  for (const c of entrantes) {
    const id = porRut.get(normalizarRut(c.rut))
    if (id) plan.actualizaciones.push({ id, cambios: c })
    else plan.nuevos.push(c)
  }
  return plan
}

/** Igual que planificarClientes, por código de producto. */
export function planificarProductos(existentes: Producto[], entrantes: ProductoImportado[]): Plan<ProductoImportado, ProductoImportado> {
  const porCodigo = new Map(existentes.map((p) => [p.codigo, p.id]))
  const plan: Plan<ProductoImportado, ProductoImportado> = { nuevos: [], actualizaciones: [] }
  for (const p of entrantes) {
    const id = porCodigo.get(p.codigo)
    if (id) plan.actualizaciones.push({ id, cambios: p })
    else plan.nuevos.push(p)
  }
  return plan
}
