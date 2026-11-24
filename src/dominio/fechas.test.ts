import { describe, it, expect } from 'vitest'
import { diaLocal, diaSemana, siguienteDiaHabil } from './fechas'

describe('diaLocal', () => {
  it('verano de Chile (UTC-3): 02:30Z del 25 aún es 24', () => {
    expect(diaLocal('2026-11-25T02:30:00Z')).toBe('2026-11-24')
  })
  it('invierno de Chile (UTC-4): 03:30Z del 2 aún es 1', () => {
    expect(diaLocal('2026-07-02T03:30:00Z')).toBe('2026-07-01')
  })
  it('límite de medianoche en verano: 02:59Z es el 24, 03:00Z ya es el 25', () => {
    expect(diaLocal('2026-11-25T02:59:59Z')).toBe('2026-11-24')
    expect(diaLocal('2026-11-25T03:00:00Z')).toBe('2026-11-25')
  })
  it('límite de medianoche en invierno: 03:59Z es el 1, 04:00Z ya es el 2', () => {
    expect(diaLocal('2026-07-02T03:59:59Z')).toBe('2026-07-01')
    expect(diaLocal('2026-07-02T04:00:00Z')).toBe('2026-07-02')
  })
  it('cambio de hora: el domingo 6 de sept 2026 (Chile pasa a UTC-3) el día sigue siendo coherente', () => {
    // 2026-09-06 04:00Z = 00:00 hora de invierno (a esa hora se adelanta el reloj a 01:00)
    expect(diaLocal('2026-09-06T03:59:00Z')).toBe('2026-09-05')
    expect(diaLocal('2026-09-06T04:00:00Z')).toBe('2026-09-06')
    expect(diaLocal('2026-09-07T02:59:00Z')).toBe('2026-09-06')
    expect(diaLocal('2026-09-07T03:00:00Z')).toBe('2026-09-07')
  })
})

describe('diaSemana', () => {
  it('martes es 2, lunes 1, domingo 7', () => {
    expect(diaSemana('2026-11-24')).toBe(2)
    expect(diaSemana('2026-11-23')).toBe(1)
    expect(diaSemana('2026-11-29')).toBe(7)
    expect(diaSemana('2026-11-28')).toBe(6)
  })
})

describe('siguienteDiaHabil', () => {
  it('después de un día de semana (lunes a jueves) es el día siguiente', () => {
    expect(siguienteDiaHabil('2026-11-23')).toBe('2026-11-24') // lunes -> martes
    expect(siguienteDiaHabil('2026-11-24')).toBe('2026-11-25')
    expect(siguienteDiaHabil('2026-11-26')).toBe('2026-11-27') // jueves -> viernes
  })
  it('viernes, sábado y domingo apuntan al lunes', () => {
    expect(siguienteDiaHabil('2026-11-27')).toBe('2026-11-30') // viernes
    expect(siguienteDiaHabil('2026-11-28')).toBe('2026-11-30') // sábado
    expect(siguienteDiaHabil('2026-11-29')).toBe('2026-11-30') // domingo
  })
  it('cruza fin de mes y de año', () => {
    expect(siguienteDiaHabil('2026-12-31')).toBe('2027-01-01') // jueves
    expect(siguienteDiaHabil('2027-01-01')).toBe('2027-01-04') // viernes
    expect(siguienteDiaHabil('2026-02-27')).toBe('2026-03-02')
  })
  it('rechaza fechas inválidas', () => {
    expect(() => siguienteDiaHabil('mañana')).toThrow('Fecha inválida')
  })
})
