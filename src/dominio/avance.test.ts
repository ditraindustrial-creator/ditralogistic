import { describe, it, expect } from 'vitest'
import {
  distribucionPorEtapa,
  unidadesListas,
  validarMovimiento,
  validarEtapasMovimiento,
  validarEtapasFinales,
  SOLO_ENTREGAR_CON_DOCUMENTO,
  SOLO_GESTION_CORRIGE_ENTREGAS,
  ErrorMovimiento,
} from './avance'
import type { Etapa, Movimiento } from './tipos'

const etapas: Etapa[] = [
  { id: 'recibido', area: 'afilado', orden: 1, nombre: 'Recibido', esListo: false, esFinal: false },
  { id: 'taller', area: 'afilado', orden: 2, nombre: 'En taller', esListo: false, esFinal: false },
  { id: 'listo', area: 'afilado', orden: 4, nombre: 'Listo', esListo: true, esFinal: false },
  { id: 'entregado', area: 'afilado', orden: 5, nombre: 'Entregado', esListo: false, esFinal: true },
]

function mov(cantidad: number, origen: string | null, destino: string): Movimiento {
  return {
    id: `${origen}-${destino}-${cantidad}`,
    lineaId: 'l1',
    cantidad,
    etapaOrigenId: origen,
    etapaDestinoId: destino,
    usuarioId: 'u1',
    creadoEn: '2026-11-24T10:00:00Z',
  }
}

// 6 unidades recibidas en "En taller" y luego 4 movidas a "Listo"
const movs = [mov(6, null, 'taller'), mov(4, 'taller', 'listo')]

describe('distribucionPorEtapa', () => {
  it('suma destinos y resta orígenes', () => {
    const d = distribucionPorEtapa(movs)
    expect(d.get('taller')).toBe(2)
    expect(d.get('listo')).toBe(4)
  })
  it('omite etapas que quedaron en cero', () => {
    const d = distribucionPorEtapa([mov(6, null, 'taller'), mov(6, 'taller', 'listo')])
    expect(d.has('taller')).toBe(false)
    expect(d.get('listo')).toBe(6)
  })
  it('sin movimientos no hay unidades', () => {
    expect(distribucionPorEtapa([]).size).toBe(0)
  })
})

describe('unidadesListas', () => {
  it('cuenta las unidades en etapas marcadas como listo', () => {
    expect(unidadesListas(movs, etapas)).toBe(4)
  })
  it('lo entregado ya no cuenta como listo', () => {
    expect(unidadesListas([...movs, mov(3, 'listo', 'entregado')], etapas)).toBe(1)
  })
})

describe('validarMovimiento', () => {
  const d = distribucionPorEtapa(movs)
  it('lanza si se mueven más unidades de las que hay en el origen', () => {
    expect(() => validarMovimiento(d, 'taller', 3)).toThrow(ErrorMovimiento)
    expect(() => validarMovimiento(d, 'taller', 3)).toThrow('Solo hay 2 unidades en esta etapa; no se pueden mover 3.')
  })
  it('lanza para 0, negativos y decimales', () => {
    for (const c of [0, -1, 1.5]) {
      expect(() => validarMovimiento(d, 'taller', c)).toThrow(ErrorMovimiento)
      expect(() => validarMovimiento(d, 'taller', c)).toThrow('La cantidad debe ser un número entero mayor que cero.')
    }
  })
  it('lanza para NaN e infinito', () => {
    expect(() => validarMovimiento(d, 'taller', Number.NaN)).toThrow(ErrorMovimiento)
    expect(() => validarMovimiento(d, 'taller', Number.POSITIVE_INFINITY)).toThrow(ErrorMovimiento)
  })
  it('lanza si el origen no tiene unidades', () => {
    expect(() => validarMovimiento(d, 'entregado', 1)).toThrow('Solo hay 0 unidades en esta etapa; no se pueden mover 1.')
  })
  it('no lanza si alcanzan las unidades', () => {
    expect(() => validarMovimiento(d, 'taller', 2)).not.toThrow()
  })
})

describe('validarEtapasMovimiento', () => {
  const enc: Etapa = { id: 'enc', area: 'encuadernacion', orden: 2, nombre: 'En producción', esListo: false, esFinal: false }
  it('lanza si origen y destino son la misma etapa', () => {
    expect(() => validarEtapasMovimiento(etapas[1], etapas[1], 'afilado')).toThrow(
      'La etapa de origen y la de destino deben ser distintas.',
    )
  })
  it('lanza si alguna etapa es de otra área o no existe', () => {
    const msg = 'Las etapas no corresponden al área del trabajo.'
    expect(() => validarEtapasMovimiento(etapas[1], enc, 'afilado')).toThrow(msg)
    expect(() => validarEtapasMovimiento(enc, etapas[2], 'afilado')).toThrow(msg)
    expect(() => validarEtapasMovimiento(etapas[1], undefined, 'afilado')).toThrow(ErrorMovimiento)
  })
  it('acepta etapas distintas de la misma área', () => {
    expect(() => validarEtapasMovimiento(etapas[1], etapas[2], 'afilado')).not.toThrow()
  })
})

describe('validarEtapasFinales', () => {
  const listo: Etapa = { id: 'l', area: 'afilado', orden: 4, nombre: 'Listo', esListo: true, esFinal: false }
  const final: Etapa = { id: 'f', area: 'afilado', orden: 5, nombre: 'Entregado', esListo: false, esFinal: true }
  const taller: Etapa = { id: 't', area: 'afilado', orden: 2, nombre: 'En taller', esListo: false, esFinal: false }
  it('nadie lleva unidades a la etapa final con un movimiento común (ni gestión)', () => {
    expect(() => validarEtapasFinales(listo, final, true)).toThrow(new ErrorMovimiento(SOLO_ENTREGAR_CON_DOCUMENTO))
    expect(() => validarEtapasFinales(listo, final, false)).toThrow(new ErrorMovimiento(SOLO_ENTREGAR_CON_DOCUMENTO))
  })
  it('sacar unidades de la etapa final: solo gestión', () => {
    expect(() => validarEtapasFinales(final, listo, false)).toThrow(new ErrorMovimiento(SOLO_GESTION_CORRIGE_ENTREGAS))
    expect(() => validarEtapasFinales(final, listo, true)).not.toThrow()
  })
  it('entre etapas no finales no hay restricción', () => {
    expect(() => validarEtapasFinales(taller, listo, false)).not.toThrow()
    expect(() => validarEtapasFinales(listo, taller, false)).not.toThrow()
  })
})
