import type { Area } from '../dominio/tipos'

/**
 * Color de cada área, para distinguir a simple vista los bloques de Afilado (verde azulado)
 * y de Encuadernación (fucsia). Las clases van escritas completas para que Tailwind las genere.
 */
export const COLOR_AREA: Record<Area, {
  /** Borde izquierdo grueso de una tarjeta o fila. */
  borde: string
  /** Fondo suave de la tarjeta o fila. */
  fondo: string
  /** Etiqueta con el nombre del área. */
  etiqueta: string
  /** Botón de área elegido. */
  elegido: string
}> = {
  afilado: {
    borde: 'border-teal-600',
    fondo: 'bg-teal-50',
    etiqueta: 'rounded bg-teal-100 px-2 py-0.5 font-semibold text-teal-800',
    elegido: 'border-teal-700 bg-teal-700 text-white',
  },
  encuadernacion: {
    borde: 'border-fuchsia-600',
    fondo: 'bg-fuchsia-50',
    etiqueta: 'rounded bg-fuchsia-100 px-2 py-0.5 font-semibold text-fuchsia-800',
    elegido: 'border-fuchsia-600 bg-fuchsia-600 text-white',
  },
}
