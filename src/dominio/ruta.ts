import type { FilaListo } from './listo'
import type { Cliente, Recorrido, Visita } from './tipos'
import { diaSemana } from './fechas'

export type Confirmacion = Visita['confirmada']
export const CONFIRMACIONES: readonly Confirmacion[] = ['si', 'no', 'sin_respuesta']
export const NOTA_VISITA_MAXIMA = 200

/** Una parada de la ruta de un día: un cliente, lo que se le entrega y el estado de su visita. */
export interface Parada {
  clienteId: string
  clienteNombre: string
  /** Recorrido del día al que pertenece; null si es una parada extra (visita fuera de su día o cliente sin recorrido). */
  recorridoId: string | null
  recorridoNombre: string | null
  dia: number | null
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
   * Paradas sin nada que entregar: todos los demás clientes cuyo recorrido sale ese día, y las
   * visitas extra (solicitadas o confirmadas "sí") sin entregas. Se pasa a retirar.
   */
  pasarARetirar: Parada[]
  /** Listo para salir por ruta propia, de clientes sin recorrido asignado (o con un recorrido que ya no existe). */
  sinRecorrido: FilaListo[]
  /** Listo para que el cliente retire en el mostrador (salida = cliente). */
  retiranEnMostrador: FilaListo[]
  /** Listo para despachar por encomienda. */
  porEncomienda: FilaListo[]
}

const porNombre = (a: FilaListo, b: FilaListo) => a.clienteNombre.localeCompare(b.clienteNombre, 'es') || a.numero - b.numero

/** Ordena paradas (sin modificar la lista recibida): por recorrido (nombre), las extra al final, y por cliente. */
export function ordenarParadas(paradas: Parada[]): Parada[] {
  return [...paradas].sort((a, b) => {
    if (a.recorridoId !== b.recorridoId) {
      if (a.recorridoNombre === null) return 1
      if (b.recorridoNombre === null) return -1
      return a.recorridoNombre.localeCompare(b.recorridoNombre, 'es') || (a.recorridoId! < b.recorridoId! ? -1 : 1)
    }
    return a.clienteNombre.localeCompare(b.clienteNombre, 'es')
  })
}

/**
 * Ruta de un día (`fecha` = 'YYYY-MM-DD', día calendario de Chile). Entran TODOS los clientes cuyo
 * recorrido sale ese día de la semana, y cualquier otro cliente con una visita ese día que fue
 * solicitada o confirmada "sí" (parada extra). Los que tienen algo listo para entregar por ruta
 * propia van en `paradas`; los demás en `pasarARetirar`. Una visita confirmada "no" no oculta la
 * parada: sale marcada. Requieren confirmación las paradas de clientes cuyo recorrido es lejano
 * (también si son una visita extra fuera de su día). Sábado y domingo no hay ruta.
 *
 * Nada listo desaparece: lo de clientes sin recorrido va a `sinRecorrido`, y lo que retira el cliente
 * o va por encomienda (según la modalidad de salida del trabajo) va a sus propias listas.
 * Orden: por recorrido (nombre), las paradas extra al final, y dentro de cada uno por cliente.
 */
export function armarRuta(
  fecha: string,
  filas: FilaListo[],
  clientes: Cliente[],
  recorridos: Recorrido[],
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

  const recorridoDe = (clienteId: string) => {
    const id = clientePorId.get(clienteId)?.recorridoId
    return id ? recorridoPorId.get(id) : undefined
  }

  const paradas = new Map<string, Parada>()
  const crearParada = (clienteId: string, nombre: string): Parada => {
    const recorrido = recorridoDe(clienteId)
    const delDia = recorrido && recorrido.dia === dia ? recorrido : undefined
    const visita = visitaPorCliente.get(clienteId)
    const p: Parada = {
      clienteId,
      clienteNombre: clientePorId.get(clienteId)?.nombre ?? nombre,
      recorridoId: delDia?.id ?? null,
      recorridoNombre: delDia?.nombre ?? null,
      dia: delDia?.dia ?? null,
      entregar: [],
      confirmada: visita?.confirmada ?? 'sin_respuesta',
      requiereConfirmacion: (recorrido?.lejano ?? false) || (visita?.requiereConfirmacion ?? false),
      solicitada: visita?.solicitada ?? false,
    }
    if (visita) p.visitaId = visita.id
    if (visita?.nota) p.nota = visita.nota
    return p
  }

  if (dia <= 5) {
    for (const c of clientes) {
      if (recorridoDe(c.id)?.dia === dia) paradas.set(c.id, crearParada(c.id, c.nombre))
    }
    for (const v of visitaPorCliente.values()) {
      if (paradas.has(v.clienteId)) continue
      if (v.solicitada || v.confirmada === 'si') paradas.set(v.clienteId, crearParada(v.clienteId, 'Cliente desconocido'))
    }
  }

  const sinRecorrido: FilaListo[] = []
  for (const f of porRuta) {
    const p = paradas.get(f.clienteId)
    if (p) p.entregar.push(f)
    else if (!recorridoDe(f.clienteId)) sinRecorrido.push(f)
  }

  const todas = [...paradas.values()]
  for (const p of todas) p.entregar.sort((a, b) => a.numero - b.numero)
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
