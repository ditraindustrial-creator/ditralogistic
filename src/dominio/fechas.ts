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
