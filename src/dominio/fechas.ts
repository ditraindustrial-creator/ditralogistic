const ZONA = 'America/Santiago'

// en-CA da el orden año-mes-día; formatToParts evita depender del formato exacto de la salida.
const formato = new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit' })

/** Día calendario (`YYYY-MM-DD`) en hora de Chile de un instante ISO; respeta el cambio de hora. */
export function diaLocal(iso: string): string {
  const instante = new Date(iso)
  if (Number.isNaN(instante.getTime())) throw new Error(`Fecha inválida: ${iso}`)
  const partes = Object.fromEntries(formato.formatToParts(instante).map((p) => [p.type, p.value]))
  return `${partes.year}-${partes.month}-${partes.day}`
}

/** Día de la semana de una fecha `YYYY-MM-DD`: 1 = lunes … 7 = domingo. */
export function diaSemana(fecha: string): 1 | 2 | 3 | 4 | 5 | 6 | 7 {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha)
  if (!m) throw new Error(`Fecha inválida: ${fecha}`)
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay()
  return (d === 0 ? 7 : d) as 1 | 2 | 3 | 4 | 5 | 6 | 7
}

/**
 * Próximo día hábil (lunes a viernes) después de una fecha `YYYY-MM-DD`: el día siguiente, o el
 * lunes si la fecha es viernes, sábado o domingo. Es la fecha por defecto de la ruta de mañana.
 */
export function siguienteDiaHabil(fecha: string): string {
  const dia = diaSemana(fecha) // valida el formato
  const salto = dia === 5 ? 3 : dia === 6 ? 2 : 1
  const [a, m, d] = fecha.split('-').map(Number)
  const s = new Date(Date.UTC(a, m - 1, d + salto))
  const dos = (n: number) => String(n).padStart(2, '0')
  return `${s.getUTCFullYear()}-${dos(s.getUTCMonth() + 1)}-${dos(s.getUTCDate())}`
}

const fmtOffset = new Intl.DateTimeFormat('en', { timeZone: ZONA, timeZoneName: 'shortOffset' })

/**
 * Convierte un string de fecha-hora local de Santiago (`"YYYY-MM-DDTHH:mm"`) a ISO UTC.
 * Usa la zona horaria America/Santiago para manejar el horario de verano.
 */
export function santiagLocalToIso(localStr: string): string {
  const utcRef = new Date(`${localStr}:00Z`)
  const tz = fmtOffset.formatToParts(utcRef).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT-3'
  const m = tz.match(/GMT([+-])(\d+)/)
  const offsetHours = m ? (m[1] === '+' ? 1 : -1) * parseInt(m[2]) : -3
  return new Date(utcRef.getTime() - offsetHours * 3600000).toISOString()
}

/**
 * Milisegundos desde `ahora` hasta que cambia el día calendario en Santiago (la próxima medianoche
 * local, o la hora en que empieza el día si el cambio de hora se salta la medianoche). Sirve para
 * refrescar la fecha por defecto de una pantalla abierta. Búsqueda binaria sobre diaLocal, así
 * respeta el cambio de hora sin conocer sus reglas. Siempre > 0.
 */
export function msHastaCambioDeDia(ahora: Date): number {
  const t0 = ahora.getTime()
  const hoy = diaLocal(ahora.toISOString())
  let bajo = 0 // aún es hoy
  let alto = 26 * 3_600_000 // ya es otro día (ningún día dura más de 25 h)
  while (alto - bajo > 1) {
    const medio = Math.floor((bajo + alto) / 2)
    if (diaLocal(new Date(t0 + medio).toISOString()) === hoy) bajo = medio
    else alto = medio
  }
  return alto
}
