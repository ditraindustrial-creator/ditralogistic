import type { Area, Cliente, Etapa, Linea, Modalidad, Movimiento, Recorrido, Trabajo } from './tipos'

/** Todo lo que hace falta para calcular el estado de la operación (entrada de `resumenListo`). */
export interface DatosOperacion {
  trabajos: Trabajo[]
  lineas: Linea[]
  movimientos: Movimiento[]
  etapas: Etapa[]
  clientes: Cliente[]
  recorridos: Recorrido[]
}

export interface FilaListo {
  trabajoId: string
  numero: number
  clienteId: string
  clienteNombre: string
  area: Area
  salida: Modalidad
  listas: number
  /** Unidades pedidas en el trabajo (incluye las ya entregadas). */
  total: number
  /** Unidades ya entregadas (en una etapa final). */
  entregadas: number
  /** Unidades que siguen en la operación: total - entregadas. */
  pendientes: number
  /** Instante (ISO) del último movimiento hacia una etapa "listo"; null si no hay unidades listas. */
  listoDesde: string | null
  recorrido: string | null
  dia: number | null
}

/**
 * Una fila por trabajo en curso: cuántas unidades están listas, desde cuándo y en qué recorrido y
 * día se entregan. Los trabajos totalmente entregados (todas las unidades en una etapa final) se
 * omiten. Recorre cada lista una sola vez: O(trabajos + líneas + movimientos).
 */
export function resumenListo(datos: DatosOperacion): FilaListo[] {
  const etapaPorId = new Map(datos.etapas.map((e) => [e.id, e]))
  const clientePorId = new Map(datos.clientes.map((c) => [c.id, c]))
  const recorridoPorId = new Map(datos.recorridos.map((r) => [r.id, r]))

  // Unidades por trabajo: pedidas, listas y en etapa final; y el último movimiento hacia "listo".
  interface Acum { total: number; listas: number; finales: number; listoDesde: string | null }
  const acum = new Map<string, Acum>()
  const trabajoDeLinea = new Map<string, Acum>()
  for (const t of datos.trabajos) acum.set(t.id, { total: 0, listas: 0, finales: 0, listoDesde: null })
  for (const l of datos.lineas) {
    const a = acum.get(l.trabajoId)
    if (!a) continue
    a.total += l.cantidad
    trabajoDeLinea.set(l.id, a)
  }
  for (const m of datos.movimientos) {
    const a = trabajoDeLinea.get(m.lineaId)
    if (!a) continue
    const destino = etapaPorId.get(m.etapaDestinoId)
    const origen = m.etapaOrigenId === null ? undefined : etapaPorId.get(m.etapaOrigenId)
    if (destino?.esListo) {
      a.listas += m.cantidad
      if (a.listoDesde === null || Date.parse(m.creadoEn) > Date.parse(a.listoDesde)) a.listoDesde = m.creadoEn
    }
    if (origen?.esListo) a.listas -= m.cantidad
    if (destino?.esFinal) a.finales += m.cantidad
    if (origen?.esFinal) a.finales -= m.cantidad
  }

  const filas: FilaListo[] = []
  for (const t of datos.trabajos) {
    const a = acum.get(t.id)!
    if (a.total > 0 && a.finales >= a.total) continue
    const cliente = clientePorId.get(t.clienteId)
    const recorrido = cliente?.recorridoId ? recorridoPorId.get(cliente.recorridoId) : undefined
    filas.push({
      trabajoId: t.id,
      numero: t.numero,
      clienteId: t.clienteId,
      clienteNombre: cliente?.nombre ?? 'Cliente desconocido',
      area: t.area,
      salida: t.salida,
      listas: a.listas,
      total: a.total,
      entregadas: a.finales,
      pendientes: a.total - a.finales,
      listoDesde: a.listas > 0 ? a.listoDesde : null,
      recorrido: recorrido?.nombre ?? null,
      dia: recorrido?.dia ?? null,
    })
  }
  return filas
}
