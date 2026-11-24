import type { Area, Etapa, Movimiento } from './tipos'

/** Error de regla de negocio al mover unidades; el mensaje se muestra tal cual al usuario. */
export class ErrorMovimiento extends Error {
  constructor(mensaje: string) {
    super(mensaje)
    this.name = 'ErrorMovimiento'
  }
}

/** Unidades de una línea en cada etapa (id de etapa → cantidad), calculadas desde los movimientos. */
export function distribucionPorEtapa(movs: Movimiento[]): Map<string, number> {
  const dist = new Map<string, number>()
  for (const m of movs) {
    dist.set(m.etapaDestinoId, (dist.get(m.etapaDestinoId) ?? 0) + m.cantidad)
    if (m.etapaOrigenId !== null) {
      dist.set(m.etapaOrigenId, (dist.get(m.etapaOrigenId) ?? 0) - m.cantidad)
    }
  }
  for (const [etapa, n] of dist) if (n === 0) dist.delete(etapa)
  return dist
}

/** Unidades que están en una etapa marcada como "listo". */
export function unidadesListas(movs: Movimiento[], etapas: Etapa[]): number {
  const dist = distribucionPorEtapa(movs)
  return etapas.filter((e) => e.esListo).reduce((suma, e) => suma + (dist.get(e.id) ?? 0), 0)
}

/** Lanza ErrorMovimiento si la cantidad no es un entero mayor que cero. */
export function validarCantidad(cantidad: number): void {
  if (!Number.isInteger(cantidad) || cantidad <= 0) {
    throw new ErrorMovimiento('La cantidad debe ser un número entero mayor que cero.')
  }
}

/** Lanza ErrorMovimiento si no se pueden mover `cantidad` unidades desde `origenId`. */
export function validarMovimiento(dist: Map<string, number>, origenId: string, cantidad: number): void {
  validarCantidad(cantidad)
  const disponibles = dist.get(origenId) ?? 0
  if (cantidad > disponibles) {
    throw new ErrorMovimiento(
      `Solo hay ${disponibles} ${disponibles === 1 ? 'unidad' : 'unidades'} en esta etapa; no se pueden mover ${cantidad}.`,
    )
  }
}

/** Origen y destino deben existir, ser distintos y pertenecer al área del trabajo de la línea. */
export function validarEtapasMovimiento(origen: Etapa | undefined, destino: Etapa | undefined, area: Area): void {
  if (origen && destino && origen.id === destino.id) {
    throw new ErrorMovimiento('La etapa de origen y la de destino deben ser distintas.')
  }
  if (!origen || !destino || origen.area !== area || destino.area !== area) {
    throw new ErrorMovimiento('Las etapas no corresponden al área del trabajo.')
  }
}
