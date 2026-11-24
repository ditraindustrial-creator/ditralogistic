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
