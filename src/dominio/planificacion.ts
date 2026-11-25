import type { EntregaParcial, Trabajo } from './tipos'

/**
 * Task 11: detalle del taller por línea (servicio + detalle técnico) y horas planificadas de entrega
 * en encuadernación (una por trabajo y una por cada entrega parcial). Las horas planificadas son hora
 * de reloj de Chile, 'YYYY-MM-DDTHH:mm' (en la base: timestamp sin zona), así no hay conversiones.
 */

export const SERVICIO_MAXIMO = 200
export const DETALLE_MAXIMO = 1000
export const NOTA_PARCIAL_MAXIMA = 200
export const PARCIALES_MAXIMAS = 50

/** Error de regla al guardar el detalle o la planificación; el mensaje está en español y se muestra tal cual. */
export class ErrorPlanificacion extends Error {
  constructor(mensaje: string) {
    super(mensaje)
    this.name = 'ErrorPlanificacion'
  }
}

export interface DetalleTaller {
  servicio?: string
  detalle?: string
}

/** Recorta y valida el detalle; un texto vacío se guarda como "sin dato". Lanza ErrorPlanificacion. */
export function normalizarDetalle(d: DetalleTaller): { servicio: string | null; detalle: string | null } {
  const servicio = (d.servicio ?? '').trim()
  const detalle = (d.detalle ?? '').trim()
  if (servicio.length > SERVICIO_MAXIMO) throw new ErrorPlanificacion(`El servicio puede tener hasta ${SERVICIO_MAXIMO} caracteres.`)
  if (detalle.length > DETALLE_MAXIMO) throw new ErrorPlanificacion(`El detalle puede tener hasta ${DETALLE_MAXIMO} caracteres.`)
  return { servicio: servicio || null, detalle: detalle || null }
}

/** Una entrega parcial al planificar (sin id: se reemplazan todas las del trabajo de una vez). */
export interface ParcialNueva {
  planificada: string
  cantidad?: number
  nota?: string
}

export interface PlanEntregas {
  /** Hora planificada de la entrega del trabajo completo; sin valor = sin planificar. */
  entrega?: string
  parciales: ParcialNueva[]
}

const FECHA_HORA = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/

/** ¿Es 'YYYY-MM-DDTHH:mm' una fecha y hora que existe (p. ej. no 31 de febrero ni 25:00)? */
export function fechaHoraValida(s: string): boolean {
  const m = FECHA_HORA.exec(s)
  if (!m) return false
  const [a, mes, d, h, min] = m.slice(1).map(Number)
  const f = new Date(Date.UTC(a, mes - 1, d))
  return f.getUTCFullYear() === a && f.getUTCMonth() === mes - 1 && f.getUTCDate() === d && h <= 23 && min <= 59
}

/** Acepta 'YYYY-MM-DDTHH:mm' con o sin segundos (como la devuelve la base) y la deja en minutos. */
export function recortarFechaHora(s: string): string {
  return s.slice(0, 16)
}

/**
 * Valida y normaliza un plan: horas existentes, cantidades enteras > 0, notas cortas, y que las
 * parciales con cantidad no sumen más que las unidades del trabajo. Devuelve las parciales ordenadas
 * por hora. Lanza ErrorPlanificacion.
 */
export function validarPlan(plan: PlanEntregas, totalUnidades: number): PlanEntregas {
  const entrega = plan.entrega?.trim() || undefined
  if (entrega !== undefined && !fechaHoraValida(entrega)) {
    throw new ErrorPlanificacion('Revisa la fecha y hora de entrega del trabajo.')
  }
  if (plan.parciales.length > PARCIALES_MAXIMAS) {
    throw new ErrorPlanificacion(`Se pueden planificar hasta ${PARCIALES_MAXIMAS} entregas parciales.`)
  }
  let suma = 0
  const parciales = plan.parciales.map((p, i) => {
    const n = i + 1
    if (!fechaHoraValida(p.planificada.trim())) throw new ErrorPlanificacion(`Revisa la fecha y hora de la entrega parcial ${n}.`)
    const out: ParcialNueva = { planificada: p.planificada.trim() }
    if (p.cantidad !== undefined) {
      if (!Number.isInteger(p.cantidad) || p.cantidad <= 0) {
        throw new ErrorPlanificacion(`La cantidad de la entrega parcial ${n} debe ser un número entero mayor que cero.`)
      }
      out.cantidad = p.cantidad
      suma += p.cantidad
    }
    const nota = (p.nota ?? '').trim()
    if (nota.length > NOTA_PARCIAL_MAXIMA) {
      throw new ErrorPlanificacion(`La nota de la entrega parcial ${n} puede tener hasta ${NOTA_PARCIAL_MAXIMA} caracteres.`)
    }
    if (nota) out.nota = nota
    return out
  })
  if (suma > totalUnidades) {
    throw new ErrorPlanificacion(`Las entregas parciales suman ${suma} unidades, pero el trabajo tiene ${totalUnidades}.`)
  }
  parciales.sort((x, y) => (x.planificada < y.planificada ? -1 : x.planificada > y.planificada ? 1 : 0))
  return entrega === undefined ? { parciales } : { entrega, parciales }
}

const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']

/** 'YYYY-MM-DDTHH:mm' → "jue 26/11 15:00" (la hora ya es de Chile). */
export function etiquetaPlanificada(s: string): string {
  const v = recortarFechaHora(s)
  if (!fechaHoraValida(v)) return s
  const [fecha, hora] = v.split('T')
  const [a, m, d] = fecha.split('-').map(Number)
  const dia = DIAS[new Date(Date.UTC(a, m - 1, d)).getUTCDay()]
  return `${dia} ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')} ${hora}`
}

const formatoAhora = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
})

/** Instante ISO → hora de reloj en Chile 'YYYY-MM-DDTHH:mm' (para comparar con las planificadas). */
export function fechaHoraSantiago(iso: string): string {
  const instante = new Date(iso)
  if (Number.isNaN(instante.getTime())) throw new Error(`Fecha inválida: ${iso}`)
  const p = Object.fromEntries(formatoAhora.formatToParts(instante).map((x) => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`
}

/** Plan de entregas de un trabajo, con las parciales ordenadas por hora. */
export interface PlanTrabajo {
  entrega?: string
  parciales: EntregaParcial[]
}

/** Agrupa las entregas parciales por trabajo (ordenadas por hora) y les suma la hora del trabajo. */
export function planesPorTrabajo(trabajos: Trabajo[], parciales: EntregaParcial[] = []): Map<string, PlanTrabajo> {
  const planes = new Map<string, PlanTrabajo>()
  for (const t of trabajos) {
    if (t.entregaPlanificada) planes.set(t.id, { entrega: t.entregaPlanificada, parciales: [] })
  }
  for (const p of parciales) {
    let plan = planes.get(p.trabajoId)
    if (!plan) {
      if (!trabajos.some((t) => t.id === p.trabajoId)) continue
      plan = { parciales: [] }
      planes.set(p.trabajoId, plan)
    }
    plan.parciales.push(p)
  }
  for (const plan of planes.values()) {
    plan.parciales.sort((x, y) => (x.planificada < y.planificada ? -1 : x.planificada > y.planificada ? 1 : 0))
  }
  return planes
}

/**
 * Texto corto del plan para listas y hojas: la próxima entrega parcial pendiente (desde `ahora`,
 * 'YYYY-MM-DDTHH:mm' de Chile) y la del trabajo completo, p. ej.
 * "Parcial: jue 26/11 10:00 (40 u.) · Total: vie 27/11 15:00". Sin plan, undefined.
 */
export function resumenPlan(plan: PlanTrabajo | undefined, ahora: string): string | undefined {
  if (!plan) return undefined
  const partes: string[] = []
  const proxima = plan.parciales.find((p) => recortarFechaHora(p.planificada) >= ahora) ?? undefined
  if (proxima) {
    partes.push(`Parcial: ${etiquetaPlanificada(proxima.planificada)}${proxima.cantidad ? ` (${proxima.cantidad} u.)` : ''}`)
  } else if (plan.parciales.length > 0 && !plan.entrega) {
    const ultima = plan.parciales[plan.parciales.length - 1]
    partes.push(`Parcial: ${etiquetaPlanificada(ultima.planificada)}`)
  }
  if (plan.entrega) partes.push(`Total: ${etiquetaPlanificada(plan.entrega)}`)
  return partes.length > 0 ? partes.join(' · ') : undefined
}
