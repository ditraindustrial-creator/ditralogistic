import { diaLocal, diaSemana } from './fechas'
import type { DatosOperacion } from './listo'
import type { Etapa, Movimiento } from './tipos'

export interface FilaReporte {
  clienteNombre: string
  trabajoId: string
  trabajoNumero: number
  producto: string
  /** Detalle anotado en recepción. */
  nota?: string
  cantidad: number
  /** 'HH:mm' en hora de Santiago. */
  hora: string
  /** Día local (`YYYY-MM-DD`) de esa hora. */
  dia: string
  /** Instante exacto (ISO); sirve para ordenar. */
  desde: string
  urgente: boolean
}

export interface ReporteDiario {
  /**
   * Unidades que llegaron a una etapa "listo" durante la fecha (neto: se descuentan las devueltas ese
   * día desde "listo" a una etapa no final; nunca más que la cantidad de la línea).
   */
  listo: FilaReporte[]
  /** Unidades en etapas intermedias al cierre de la fecha. */
  enProduccion: FilaReporte[]
  /** Unidades en una etapa "listo" al cierre de la fecha (aunque quedaran listas antes). */
  porEntregar: FilaReporte[]
  /** Informativa: unidades aún en la etapa inicial, para que nada desaparezca. */
  recibido: FilaReporte[]
  /** Líneas ignoradas porque sus movimientos apuntan a etapas desconocidas. */
  sinClasificar: number
}

const formatoHora = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
})

/** 'HH:mm' de un instante ISO en hora de Santiago. */
export function horaSantiago(iso: string): string {
  const p = Object.fromEntries(formatoHora.formatToParts(new Date(iso)).map((x) => [x.type, x.value]))
  return `${p.hour}:${p.minute}`
}

const DIAS_CORTOS = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom']
const aUtc = (f: string) => {
  const [a, m, d] = f.split('-').map(Number)
  return Date.UTC(a, m - 1, d)
}

/**
 * Hora para mostrar: sola si es de la fecha del reporte; "ayer 16:40", "lun 16:40" (hasta 6 días
 * antes) o "10/11 16:40" cuando es más antigua.
 */
export function etiquetaHora(dia: string, fecha: string, hora: string): string {
  if (dia === fecha) return hora
  const atras = Math.round((aUtc(fecha) - aUtc(dia)) / 86_400_000)
  if (atras === 1) return `ayer ${hora}`
  if (atras >= 2 && atras <= 6) return `${DIAS_CORTOS[diaSemana(dia) - 1]} ${hora}`
  const [, m, d] = dia.split('-').map(Number)
  return `${d}/${m} ${hora}`
}

/**
 * Reporte de encuadernación "al cierre" de `fecha` (día local de Santiago): solo se reproducen los
 * movimientos de ese día o anteriores, así un reporte pasado no cambia. O(movimientos): se indexan
 * por línea una sola vez.
 */
export function reporteDiario(fecha: string, datos: DatosOperacion): ReporteDiario {
  const etapaPorId = new Map<string, Etapa>(datos.etapas.map((e) => [e.id, e]))
  const clientePorId = new Map(datos.clientes.map((c) => [c.id, c]))
  const trabajoPorId = new Map(datos.trabajos.map((t) => [t.id, t]))
  const inicial = datos.etapas
    .filter((e) => e.area === 'encuadernacion')
    .reduce<Etapa | undefined>((menor, e) => (!menor || e.orden < menor.orden ? e : menor), undefined)

  const porLinea = new Map<string, Movimiento[]>()
  for (const m of datos.movimientos) {
    if (diaLocal(m.creadoEn) > fecha) continue
    const lista = porLinea.get(m.lineaId)
    if (lista) lista.push(m)
    else porLinea.set(m.lineaId, [m])
  }

  const r: ReporteDiario = { listo: [], enProduccion: [], porEntregar: [], recibido: [], sinClasificar: 0 }

  for (const linea of datos.lineas) {
    const trabajo = trabajoPorId.get(linea.trabajoId)
    if (!trabajo || trabajo.area !== 'encuadernacion') continue
    const movs = porLinea.get(linea.id)
    if (!movs) continue
    const ordenados = movs.map((m, i) => ({ m, i, t: Date.parse(m.creadoEn) })).sort((a, b) => a.t - b.t || a.i - b.i)

    const unidades = new Map<string, number>()
    const ultimoEn = new Map<string, string>() // etapa -> instante del último movimiento que puso unidades ahí
    let listoHoy = 0
    let listoHoyDesde: string | null = null
    let desconocida = false
    for (const { m } of ordenados) {
      const destino = etapaPorId.get(m.etapaDestinoId)
      const origen = m.etapaOrigenId === null ? undefined : etapaPorId.get(m.etapaOrigenId)
      if (!destino || (m.etapaOrigenId !== null && !origen)) {
        desconocida = true
        break
      }
      unidades.set(destino.id, (unidades.get(destino.id) ?? 0) + m.cantidad)
      if (origen) unidades.set(origen.id, (unidades.get(origen.id) ?? 0) - m.cantidad)
      ultimoEn.set(destino.id, m.creadoEn)
      if (diaLocal(m.creadoEn) === fecha) {
        if (destino.esListo && !origen?.esListo) {
          listoHoy += m.cantidad
          listoHoyDesde = m.creadoEn
        }
        // Devuelto el mismo día desde "listo" a una etapa no final (corrección): no cuenta dos veces.
        if (origen?.esListo && !destino.esListo && !destino.esFinal) listoHoy -= m.cantidad
      }
    }
    if (desconocida) {
      r.sinClasificar++
      continue
    }

    const fila = (cantidad: number, desde: string): FilaReporte => ({
      clienteNombre: clientePorId.get(trabajo.clienteId)?.nombre ?? 'Cliente desconocido',
      trabajoId: trabajo.id,
      trabajoNumero: trabajo.numero,
      producto: linea.producto,
      ...(linea.nota ? { nota: linea.nota } : {}),
      cantidad,
      hora: horaSantiago(desde),
      dia: diaLocal(desde),
      desde,
      urgente: trabajo.urgente,
    })

    // Neto del día, y nunca más que la cantidad de la línea (p. ej. listo → entregado → corrección → listo).
    listoHoy = Math.min(listoHoy, linea.cantidad)
    if (listoHoy > 0 && listoHoyDesde) r.listo.push(fila(listoHoy, listoHoyDesde))
    for (const [etapaId, cantidad] of unidades) {
      const etapa = etapaPorId.get(etapaId)!
      const desde = ultimoEn.get(etapaId)
      if (cantidad <= 0 || !desde || etapa.esFinal) continue
      const destino = etapa.esListo ? r.porEntregar : etapa.id === inicial?.id ? r.recibido : r.enProduccion
      destino.push(fila(cantidad, desde))
    }
  }

  const orden = (a: FilaReporte, b: FilaReporte) =>
    Number(b.urgente) - Number(a.urgente) || Date.parse(a.desde) - Date.parse(b.desde) || a.trabajoNumero - b.trabajoNumero
  for (const lista of [r.listo, r.enProduccion, r.porEntregar, r.recibido]) lista.sort(orden)
  return r
}
