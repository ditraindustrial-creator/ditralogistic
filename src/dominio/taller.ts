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
