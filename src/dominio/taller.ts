import { distribucionPorEtapa } from './avance'
import type { DatosOperacion } from './listo'
import type { Area, Etapa, Rol } from './tipos'

/** Áreas del taller que un rol puede ver y mover. Sin acceso al taller: lista vacía. */
export function areasDelRol(rol: Rol): Area[] {
  switch (rol) {
    case 'operario_afilado':
      return ['afilado']
    case 'operario_encuadernacion':
      return ['encuadernacion']
    case 'admin':
    case 'secretaria':
    case 'jefe_taller':
      return ['afilado', 'encuadernacion']
    default:
      return []
  }
}

export interface LineaTaller {
  lineaId: string
  trabajoId: string
  numero: number
  clienteNombre: string
  producto: string
  area: Area
  urgente: boolean
  recibidoEn: string
  cantidad: number
  /** Unidades que aún no llegan a una etapa final. */
  enCurso: number
  /** Etapas con unidades, en el orden del área. */
  distribucion: { etapa: Etapa; unidades: number }[]
  /** Todas las etapas del área, en orden (destinos posibles). */
  etapasArea: Etapa[]
}

/**
 * Líneas del taller en las áreas dadas, ordenadas: urgentes primero, luego la recibida hace más
 * tiempo. Las líneas con todas sus unidades en una etapa final se omiten.
 */
export function lineasEnCurso(datos: DatosOperacion, areas: Area[]): LineaTaller[] {
  const trabajoPorId = new Map(datos.trabajos.map((t) => [t.id, t]))
  const clientePorId = new Map(datos.clientes.map((c) => [c.id, c]))
  const etapasPorArea = new Map<Area, Etapa[]>()
  for (const a of areas) {
    etapasPorArea.set(a, datos.etapas.filter((e) => e.area === a).sort((x, y) => x.orden - y.orden))
  }
  const movsPorLinea = new Map<string, typeof datos.movimientos>()
  for (const m of datos.movimientos) {
    const l = movsPorLinea.get(m.lineaId)
    if (l) l.push(m)
    else movsPorLinea.set(m.lineaId, [m])
  }

  const salida: LineaTaller[] = []
  for (const l of datos.lineas) {
    const t = trabajoPorId.get(l.trabajoId)
    const etapasArea = t && etapasPorArea.get(t.area)
    if (!t || !etapasArea) continue
    const dist = distribucionPorEtapa(movsPorLinea.get(l.id) ?? [])
    const distribucion = etapasArea.flatMap((etapa) => {
      const unidades = dist.get(etapa.id) ?? 0
      return unidades > 0 ? [{ etapa, unidades }] : []
    })
    const enCurso = distribucion.filter((d) => !d.etapa.esFinal).reduce((s, d) => s + d.unidades, 0)
    if (enCurso === 0) continue
    salida.push({
      lineaId: l.id,
      trabajoId: t.id,
      numero: t.numero,
      clienteNombre: clientePorId.get(t.clienteId)?.nombre ?? 'Cliente desconocido',
      producto: l.producto,
      area: t.area,
      urgente: t.urgente,
      recibidoEn: t.recibidoEn,
      cantidad: l.cantidad,
      enCurso,
      distribucion,
      etapasArea,
    })
  }
  return salida.sort(
    (a, b) =>
      Number(b.urgente) - Number(a.urgente) ||
      Date.parse(a.recibidoEn) - Date.parse(b.recibidoEn) ||
      a.numero - b.numero ||
      a.producto.localeCompare(b.producto, 'es'),
  )
}

type Distribucion = LineaTaller['distribucion']

/** Origen por defecto: la primera etapa (en orden) con unidades que no sea final. */
export function origenPorDefecto(distribucion: Distribucion): string {
  return (distribucion.find((d) => !d.etapa.esFinal) ?? distribucion[0]).etapa.id
}

/** Destino por defecto: la etapa siguiente del área (o la anterior si el origen es la última). */
export function destinoPorDefecto(etapasArea: Etapa[], origenId: string): string {
  const i = etapasArea.findIndex((e) => e.id === origenId)
  return (etapasArea[i + 1] ?? etapasArea[i - 1] ?? etapasArea[0]).id
}

export interface SeleccionMovimiento {
  lineaId: string
  origenId: string
  destinoId: string
  cantidad: string
}

/**
 * Ajusta una selección abierta a datos recién cargados: si el origen ya no tiene unidades vuelve
 * al origen, destino y cantidad por defecto; si tiene menos que la cantidad pedida, la baja al
 * máximo. Devuelve la misma selección si sigue válida, o null si la línea ya no tiene unidades.
 */
export function reconciliarSeleccion<S extends SeleccionMovimiento>(sel: S, distribucion: Distribucion, etapasArea: Etapa[]): S | null {
  if (distribucion.length === 0) return null
  const max = distribucion.find((d) => d.etapa.id === sel.origenId)?.unidades ?? 0
  if (max === 0) {
    const origenId = origenPorDefecto(distribucion)
    const todas = distribucion.find((d) => d.etapa.id === origenId)!.unidades
    return { ...sel, origenId, destinoId: destinoPorDefecto(etapasArea, origenId), cantidad: String(todas) }
  }
  const pedida = sel.cantidad.trim() === '' ? NaN : Number(sel.cantidad)
  if (pedida > max) return { ...sel, cantidad: String(max) }
  return sel
}
