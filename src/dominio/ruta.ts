import type { FilaListo } from './listo'
import type { Asignacion, Cliente, Recorrido, Visita } from './tipos'
import { diaSemana } from './fechas'

export type Confirmacion = Visita['confirmada']
export const CONFIRMACIONES: readonly Confirmacion[] = ['si', 'no', 'sin_respuesta']
export const NOTA_VISITA_MAXIMA = 200

/** Una parada de la ruta de un día: un cliente, lo que se le entrega y el estado de su visita. */
export interface Parada {
  clienteId: string
  clienteNombre: string
  /** Recorrido del día al que pertenece; null si es una parada extra (visita fuera de sus días o cliente sin recorrido). */
  recorridoId: string | null
  recorridoNombre: string | null
  dia: number | null
  /** true si el cliente es fijo en el recorrido de ese día; false si es "a pedido" o una parada extra. */
  fija: boolean
  /** Orden sugerido dentro del recorrido (0 en las paradas extra). El chofer decide el orden real. */
  orden: number
  /** Trabajos con unidades listas que salen por ruta propia. */
  entregar: FilaListo[]
  visitaId?: string
  confirmada: Confirmacion
  requiereConfirmacion: boolean
  solicitada: boolean
  nota?: string
}

export interface RutaDelDia {
  /** Paradas con algo que entregar por ruta propia (van primero). */
  paradas: Parada[]
  /**
   * Paradas sin nada que entregar: los clientes FIJOS de los recorridos de ese día, los "a pedido"
   * con visita solicitada o confirmada "sí", y las visitas extra sin entregas. Se pasa a retirar.
   */
  pasarARetirar: Parada[]
  /** Listo para salir por ruta propia, de clientes sin ningún recorrido asignado (o solo recorridos que ya no existen). */
  sinRecorrido: FilaListo[]
  /** Listo para que el cliente retire en el mostrador (salida = cliente). */
  retiranEnMostrador: FilaListo[]
  /** Listo para despachar por encomienda. */
  porEncomienda: FilaListo[]
}

const porNombre = (a: FilaListo, b: FilaListo) => a.clienteNombre.localeCompare(b.clienteNombre, 'es') || a.numero - b.numero

/**
 * Ordena paradas (sin modificar la lista recibida): por recorrido (nombre), las extra al final, y
 * dentro de cada recorrido por `orden` y luego por cliente.
 */
export function ordenarParadas(paradas: Parada[]): Parada[] {
  return [...paradas].sort((a, b) => {
    if (a.recorridoId !== b.recorridoId) {
      if (a.recorridoNombre === null) return 1
      if (b.recorridoNombre === null) return -1
      return a.recorridoNombre.localeCompare(b.recorridoNombre, 'es') || (a.recorridoId! < b.recorridoId! ? -1 : 1)
    }
    return a.orden - b.orden || a.clienteNombre.localeCompare(b.clienteNombre, 'es')
  })
}

/** Minúsculas, sin tildes y con los espacios normalizados: para comparar nombres escritos a mano. */
export function normalizarNombre(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

/**
 * Recorrido de la fecha cuyo chofer titular es `nombre` (el nombre del perfil), comparando sin
 * mayúsculas, tildes ni espacios sobrantes. undefined si no hay ninguno (o es fin de semana).
 */
export function recorridoDelChofer(recorridos: Recorrido[], fecha: string, nombre: string): Recorrido | undefined {
  const dia = diaSemana(fecha)
  const buscado = normalizarNombre(nombre)
  if (buscado === '') return undefined
  return recorridos.find((r) => r.dia === dia && r.chofer !== undefined && normalizarNombre(r.chofer) === buscado)
}

/**
 * Ruta de un día (`fecha` = 'YYYY-MM-DD', día calendario de Chile). Para cada recorrido que sale ese
 * día de la semana, sus clientes asignados (cliente_recorridos):
 * - FIJOS: entran siempre (con algo que entregar en `paradas`; si no, en `pasarARetirar`).
 * - A PEDIDO: entran solo si tienen algo listo para entregar por ruta propia, o una visita ese día
 *   solicitada o confirmada "sí".
 * Además entra cualquier otro cliente con una visita ese día solicitada o confirmada "sí" (parada
 * extra, sin recorrido del día). Una visita confirmada "no" no oculta la parada: sale marcada.
 * Requieren confirmación las paradas de un recorrido lejano y las visitas marcadas así; una visita
 * extra usa el "lejano" del recorrido del cliente de ESE día (si no tiene, no). Sábado y domingo no hay ruta.
 *
 * Si un cliente está en dos recorridos del MISMO día sale una sola vez (sus entregas no se
 * duplican), en el primero según: fijo antes que a pedido, menor `orden`, nombre del recorrido, id.
 *
 * Nada listo desaparece: lo de clientes sin ningún recorrido va a `sinRecorrido`, lo que retira el
 * cliente o va por encomienda a sus propias listas, y lo de clientes cuyos recorridos son de otros
 * días queda para esos días (la pantalla lo cuenta aparte).
 * Orden: por recorrido (nombre), las paradas extra al final; dentro de cada uno por `orden` y cliente.
 */
export function armarRuta(
  fecha: string,
  filas: FilaListo[],
  clientes: Cliente[],
  recorridos: Recorrido[],
  asignaciones: Asignacion[],
  visitas: Visita[],
): RutaDelDia {
  const dia = diaSemana(fecha)
  const clientePorId = new Map(clientes.map((c) => [c.id, c]))
  const recorridoPorId = new Map(recorridos.map((r) => [r.id, r]))
  const visitaPorCliente = new Map<string, Visita>()
  for (const v of visitas) if (v.fecha === fecha) visitaPorCliente.set(v.clienteId, v)

  const listas = filas.filter((f) => f.listas > 0)
  const retiranEnMostrador = listas.filter((f) => f.salida === 'cliente').sort(porNombre)
  const porEncomienda = listas.filter((f) => f.salida === 'encomienda').sort(porNombre)
  const porRuta = listas.filter((f) => f.salida === 'ruta_propia')
  const porRutaDe = new Map<string, FilaListo[]>()
  for (const f of porRuta) porRutaDe.set(f.clienteId, [...(porRutaDe.get(f.clienteId) ?? []), f])

  // Asignaciones vigentes (a recorridos que existen); y la del día de cada cliente (regla de desempate arriba).
  const conRecorrido = new Set<string>()
  const delDia = new Map<string, { a: Asignacion; r: Recorrido }>()
  const antes = (x: { a: Asignacion; r: Recorrido }, y: { a: Asignacion; r: Recorrido }) =>
    Number(y.a.fija) - Number(x.a.fija) || x.a.orden - y.a.orden || x.r.nombre.localeCompare(y.r.nombre, 'es') || (x.r.id < y.r.id ? -1 : x.r.id > y.r.id ? 1 : 0)
  for (const a of asignaciones) {
    const r = recorridoPorId.get(a.recorridoId)
    if (!r) continue
    conRecorrido.add(a.clienteId)
    if (r.dia !== dia) continue
    const previa = delDia.get(a.clienteId)
    const esta = { a, r }
    if (!previa || antes(esta, previa) < 0) delDia.set(a.clienteId, esta)
  }

  const paradas = new Map<string, Parada>()
  const crearParada = (clienteId: string, asignada?: { a: Asignacion; r: Recorrido }): Parada => {
    const visita = visitaPorCliente.get(clienteId)
    const p: Parada = {
      clienteId,
      clienteNombre: clientePorId.get(clienteId)?.nombre ?? 'Cliente desconocido',
      recorridoId: asignada?.r.id ?? null,
      recorridoNombre: asignada?.r.nombre ?? null,
      dia: asignada?.r.dia ?? null,
      fija: asignada?.a.fija ?? false,
      orden: asignada?.a.orden ?? 0,
      entregar: [...(porRutaDe.get(clienteId) ?? [])].sort((a, b) => a.numero - b.numero),
      confirmada: visita?.confirmada ?? 'sin_respuesta',
      requiereConfirmacion: (asignada?.r.lejano ?? false) || (visita?.requiereConfirmacion ?? false),
      solicitada: visita?.solicitada ?? false,
    }
    if (visita) p.visitaId = visita.id
    if (visita?.nota) p.nota = visita.nota
    return p
  }
  const pedida = (clienteId: string) => {
    const v = visitaPorCliente.get(clienteId)
    return !!v && (v.solicitada || v.confirmada === 'si')
  }

  if (dia <= 5) {
    for (const [clienteId, asignada] of delDia) {
      if (asignada.a.fija || porRutaDe.has(clienteId) || pedida(clienteId)) paradas.set(clienteId, crearParada(clienteId, asignada))
    }
    for (const v of visitaPorCliente.values()) {
      if (paradas.has(v.clienteId) || delDia.has(v.clienteId)) continue
      if (pedida(v.clienteId)) paradas.set(v.clienteId, crearParada(v.clienteId))
    }
  }

  const sinRecorrido = porRuta.filter((f) => !paradas.has(f.clienteId) && !conRecorrido.has(f.clienteId))

  const todas = [...paradas.values()]
  return {
    paradas: ordenarParadas(todas.filter((p) => p.entregar.length > 0)),
    pasarARetirar: ordenarParadas(todas.filter((p) => p.entregar.length === 0)),
    sinRecorrido: sinRecorrido.sort(porNombre),
    retiranEnMostrador,
    porEncomienda,
  }
}

/** Error de regla de negocio en visitas; el mensaje está en español y se muestra tal cual. */
export class ErrorVisita extends Error {
  constructor(mensaje: string) {
    super(mensaje)
    this.name = 'ErrorVisita'
  }
}

/** true si `fecha` es una fecha real 'YYYY-MM-DD' (rechaza 2026-02-31). */
export function fechaValida(fecha: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha)
  if (!m) return false
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3])
}

/** Mismas reglas que las restricciones de la tabla visitas (0007). Lanza ErrorVisita. */
export function validarVisita(datos: { fecha: string; clienteId: string; confirmada?: Confirmacion; nota?: string }): void {
  if (!fechaValida(datos.fecha)) throw new ErrorVisita('La fecha no es válida.')
  if (diaSemana(datos.fecha) > 5) throw new ErrorVisita('Las rutas son de lunes a viernes.')
  if (!datos.clienteId) throw new ErrorVisita('Elige el cliente.')
  if (datos.confirmada !== undefined && !CONFIRMACIONES.includes(datos.confirmada)) {
    throw new ErrorVisita('El estado de la visita no es válido.')
  }
  if (datos.nota !== undefined && [...datos.nota].length > NOTA_VISITA_MAXIMA) {
    throw new ErrorVisita(`La nota puede tener hasta ${NOTA_VISITA_MAXIMA} caracteres.`)
  }
}
