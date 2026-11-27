import type { Etapa } from '../dominio/tipos'

/**
 * Fase del proceso de una etapa, para pintarla con su color:
 * Recibido azul, En taller naranjo, Afilado/Listo verde y Despachado (entregado) fucsia.
 */
export type Fase = 'recibido' | 'taller' | 'listo' | 'despachado'

export const NOMBRE_FASE: Record<Fase, string> = {
  recibido: 'Recibido',
  taller: 'En taller',
  listo: 'Afilado / listo',
  despachado: 'Despachado',
}

/** Clasifica una etapa en su fase según sus marcas (final, listo), su orden y su nombre. */
export function faseDeEtapa(e: Pick<Etapa, 'orden' | 'nombre' | 'esListo' | 'esFinal'>): Fase {
  const nombre = e.nombre.toLowerCase()
  if (e.esFinal || /entregad|despachad/.test(nombre)) return 'despachado'
  if (e.esListo || /afilad|terminad|listo/.test(nombre)) return 'listo'
  if (e.orden <= 1 || /recibid/.test(nombre)) return 'recibido'
  return 'taller'
}

/** Clases de Tailwind por fase, escritas completas para que Tailwind las genere. */
export const COLOR_FASE: Record<Fase, {
  /** Etiqueta (chip) con el nombre de la etapa. */
  etiqueta: string
  /** Borde izquierdo grueso de una fila. */
  borde: string
  /** Texto del color de la fase (títulos). */
  texto: string
  /** Opción sin elegir: borde del color. */
  opcion: string
  /** Opción elegida: fondo lleno. */
  elegido: string
}> = {
  recibido: {
    etiqueta: 'rounded border border-blue-300 bg-blue-100 px-2 py-1 text-base font-semibold text-blue-900',
    borde: 'border-blue-500',
    texto: 'text-blue-800',
    opcion: 'border-blue-400 bg-white text-blue-900',
    elegido: 'border-blue-600 bg-blue-600 text-white',
  },
  taller: {
    etiqueta: 'rounded border border-orange-300 bg-orange-100 px-2 py-1 text-base font-semibold text-orange-900',
    borde: 'border-orange-500',
    texto: 'text-orange-800',
    opcion: 'border-orange-400 bg-white text-orange-900',
    elegido: 'border-orange-600 bg-orange-600 text-white',
  },
  listo: {
    etiqueta: 'rounded border border-green-300 bg-green-100 px-2 py-1 text-base font-semibold text-green-900',
    borde: 'border-green-500',
    texto: 'text-green-800',
    opcion: 'border-green-500 bg-white text-green-900',
    elegido: 'border-green-600 bg-green-600 text-white',
  },
  despachado: {
    etiqueta: 'rounded border border-fuchsia-300 bg-fuchsia-100 px-2 py-1 text-base font-semibold text-fuchsia-900',
    borde: 'border-fuchsia-500',
    texto: 'text-fuchsia-800',
    opcion: 'border-fuchsia-400 bg-white text-fuchsia-900',
    elegido: 'border-fuchsia-600 bg-fuchsia-600 text-white',
  },
}

export const colorEtapa = (e: Pick<Etapa, 'orden' | 'nombre' | 'esListo' | 'esFinal'>) => COLOR_FASE[faseDeEtapa(e)]
