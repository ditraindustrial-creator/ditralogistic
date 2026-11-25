import { describe, it, expect } from 'vitest'
import { diaLocal, diaSemana, msHastaCambioDeDia, siguienteDiaHabil } from './fechas'

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

describe('msHastaCambioDeDia', () => {
  const ms = (iso: string) => msHastaCambioDeDia(new Date(iso))
  it('verano (UTC-3): a las 23:59:30 de Santiago faltan 30 s', () => {
    expect(ms('2026-11-25T02:59:30Z')).toBe(30_000)
  })
  it('invierno (UTC-4): a las 23:00 de Santiago falta 1 hora', () => {
    expect(ms('2026-07-02T03:00:00Z')).toBe(3_600_000)
  })
  it('justo a medianoche falta un día entero hasta la siguiente', () => {
    expect(ms('2026-11-25T03:00:00Z')).toBe(86_400_000)
  })
  it('sept 2026 (se adelanta el reloj): el domingo 6 empieza a la 01:00 local (04:00Z) y dura 23 h', () => {
    expect(ms('2026-09-05T04:00:00Z')).toBe(24 * 3_600_000)
    expect(diaLocal(new Date(Date.parse('2026-09-05T04:00:00Z') + 24 * 3_600_000).toISOString())).toBe('2026-09-06')
    expect(ms('2026-09-06T04:00:00Z')).toBe(23 * 3_600_000)
  })
  it('abril 2026 (se atrasa el reloj): el sábado 4 dura 25 h en Santiago', () => {
    expect(ms('2026-04-04T03:00:00Z')).toBe(25 * 3_600_000)
  })
  it('siempre es positivo y como máximo 25 h', () => {
    for (let t = Date.parse('2026-01-01T00:00:00Z'); t < Date.parse('2027-01-01T00:00:00Z'); t += 7 * 3_600_000 + 123_457) {
      const n = msHastaCambioDeDia(new Date(t))
      expect(n).toBeGreaterThan(0)
      expect(n).toBeLessThanOrEqual(25 * 3_600_000)
      expect(diaLocal(new Date(t + n).toISOString())).not.toBe(diaLocal(new Date(t).toISOString()))
      expect(diaLocal(new Date(t + n - 1).toISOString())).toBe(diaLocal(new Date(t).toISOString()))
    }
  })
})
