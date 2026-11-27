import { describe, expect, it } from 'vitest'
import { faseDeEtapa } from './colorEtapa'

const e = (orden: number, nombre: string, esListo = false, esFinal = false) => ({ orden, nombre, esListo, esFinal })

describe('faseDeEtapa', () => {
  it('clasifica las etapas de afilado', () => {
    expect(faseDeEtapa(e(1, 'Recibido'))).toBe('recibido')
    expect(faseDeEtapa(e(2, 'En taller'))).toBe('taller')
    expect(faseDeEtapa(e(3, 'Afilado'))).toBe('listo')
    expect(faseDeEtapa(e(4, 'Listo', true))).toBe('listo')
    expect(faseDeEtapa(e(5, 'Entregado', false, true))).toBe('despachado')
  })
  it('clasifica las etapas de encuadernación', () => {
    expect(faseDeEtapa(e(1, 'Recibido'))).toBe('recibido')
    expect(faseDeEtapa(e(2, 'En producción'))).toBe('taller')
    expect(faseDeEtapa(e(3, 'Terminado', true))).toBe('listo')
    expect(faseDeEtapa(e(4, 'Entregado', false, true))).toBe('despachado')
  })
})
