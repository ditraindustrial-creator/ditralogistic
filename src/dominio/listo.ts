import type { Area, Asignacion, Cliente, EntregaPlanificada, Etapa, Linea, Modalidad, Movimiento, Recorrido, Trabajo } from './tipos'
import { diaSemana } from './fechas'

/** Todo lo que hace falta para calcular el estado de la operación (entrada de `resumenListo`). */
export interface DatosOperacion {
  trabajos: Trabajo[]
  lineas: Linea[]
  movimientos: Movimiento[]
  etapas: Etapa[]
  clientes: Cliente[]
  recorridos: Recorrido[]
  /** Qué clientes van en qué recorridos (cliente_recorridos); un cliente puede estar en varios. */
  asignaciones: Asignacion[]
  /** Entregas parciales planificadas (tabla entregas_planificadas). */
  entregasPlanificadas: EntregaPlanificada[]
}

/** Un recorrido del cliente (para mostrar "Rutas: Lun · Mié · Vie"). */
export interface RutaCliente {
  recorridoId: string
  recorridoNombre: string
  dia: number
}

/** La próxima vez que pasa la camioneta: el primer día de ruta del cliente desde hoy (hoy incluido). */
export interface ProximaRuta extends RutaCliente {
  /** 'YYYY-MM-DD' (día de Chile). */
  fecha: string
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
  /** Todos los recorridos del cliente, de lunes a viernes. Vacío si no tiene ninguno. */
  rutas: RutaCliente[]
  /** Próximo día de ruta desde `hoy` (hoy cuenta); null si el cliente no tiene recorrido. */
  proximaRuta: ProximaRuta | null
  /** Hora global planificada del trabajo (solo encuadernación; ISO string). */
  entregaPlanificada?: string
  /** Primera entrega parcial planificada con hora > hoy (ISO); undefined si no hay ninguna. */
  proximaEntregaPlanificada?: EntregaPlanificada
}

/** `fecha` + `n` días, en días calendario (sin horas: no le afecta el cambio de hora). */
function sumarDias(fecha: string, n: number): string {
  const [a, m, d] = fecha.split('-').map(Number)
  const s = new Date(Date.UTC(a, m - 1, d + n))
  const dos = (x: number) => String(x).padStart(2, '0')
  return `${s.getUTCFullYear()}-${dos(s.getUTCMonth() + 1)}-${dos(s.getUTCDate())}`
}

/**
 * Una fila por trabajo en curso: cuántas unidades están listas, desde cuándo, en qué recorridos va
 * el cliente y cuándo es su próxima ruta desde `hoy` ('YYYY-MM-DD' en Chile, p. ej.
 * diaLocal(new Date().toISOString())). Si hoy es día de ruta del cliente, la próxima es hoy; con dos
 * recorridos el mismo día gana el de menor orden y luego el nombre. Los trabajos totalmente entregados
 * (todas las unidades en una etapa final) se omiten. O(trabajos + líneas + movimientos + asignaciones).
 */
export function resumenListo(datos: DatosOperacion, hoy: string): FilaListo[] {
  const diaHoy = diaSemana(hoy) // valida el formato
  const etapaPorId = new Map(datos.etapas.map((e) => [e.id, e]))
  const clientePorId = new Map(datos.clientes.map((c) => [c.id, c]))
  const recorridoPorId = new Map(datos.recorridos.map((r) => [r.id, r]))

  // Rutas de cada cliente (solo recorridos que existen) y su próxima ruta.
  const rutasDe = new Map<string, { ruta: RutaCliente; orden: number }[]>()
  for (const a of datos.asignaciones) {
    const r = recorridoPorId.get(a.recorridoId)
    if (!r) continue
    const lista = rutasDe.get(a.clienteId) ?? []
    lista.push({ ruta: { recorridoId: r.id, recorridoNombre: r.nombre, dia: r.dia }, orden: a.orden })
    rutasDe.set(a.clienteId, lista)
  }
  const salto = (dia: number) => (dia - diaHoy + 7) % 7
  const infoRutas = new Map<string, { rutas: RutaCliente[]; proximaRuta: ProximaRuta | null }>()
  for (const [clienteId, lista] of rutasDe) {
    const porNombre = (x: RutaCliente, y: RutaCliente) => x.recorridoNombre.localeCompare(y.recorridoNombre, 'es') || (x.recorridoId < y.recorridoId ? -1 : 1)
    const rutas = lista.map((x) => x.ruta).sort((x, y) => x.dia - y.dia || porNombre(x, y))
    const primera = [...lista].sort((x, y) => salto(x.ruta.dia) - salto(y.ruta.dia) || x.orden - y.orden || porNombre(x.ruta, y.ruta))[0]
    infoRutas.set(clienteId, { rutas, proximaRuta: { ...primera.ruta, fecha: sumarDias(hoy, salto(primera.ruta.dia)) } })
  }

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

  // Entregas planificadas: agrupa por trabajoId, ordena por hora.
  const epPorTrabajo = new Map<string, EntregaPlanificada[]>()
  for (const ep of datos.entregasPlanificadas) {
    const lista = epPorTrabajo.get(ep.trabajoId) ?? []
    lista.push(ep)
    epPorTrabajo.set(ep.trabajoId, lista)
  }

  const filas: FilaListo[] = []
  for (const t of datos.trabajos) {
    const a = acum.get(t.id)!
    if (a.total > 0 && a.finales >= a.total) continue
    const cliente = clientePorId.get(t.clienteId)
    const info = infoRutas.get(t.clienteId)
    // Primera entrega parcial planificada futura (hora > hoy como string ISO).
    const eps = epPorTrabajo.get(t.id) ?? []
    const proximaEp = eps.filter((ep) => ep.hora > hoy).sort((x, y) => x.hora.localeCompare(y.hora))[0]
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
      rutas: info?.rutas ?? [],
      proximaRuta: info?.proximaRuta ?? null,
      ...(t.entregaPlanificada !== undefined ? { entregaPlanificada: t.entregaPlanificada } : {}),
      ...(proximaEp !== undefined ? { proximaEntregaPlanificada: proximaEp } : {}),
    })
  }
  return filas
}
