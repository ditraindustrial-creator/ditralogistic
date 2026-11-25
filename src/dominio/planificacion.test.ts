import { describe, it, expect } from 'vitest'
import {
  ErrorPlanificacion, etiquetaPlanificada, fechaHoraSantiago, fechaHoraValida, normalizarDetalle, planesPorTrabajo, resumenPlan, validarPlan,
} from './planificacion'
import { puedeDetallar, puedePlanificar } from './permisos'
import type { EntregaParcial, Trabajo } from './tipos'

describe('normalizarDetalle', () => {
  it('recorta y deja null lo vacío', () => {
    expect(normalizarDetalle({ servicio: '  Afilado recto ', detalle: '' })).toEqual({ servicio: 'Afilado recto', detalle: null })
    expect(normalizarDetalle({})).toEqual({ servicio: null, detalle: null })
  })
  it('rechaza textos demasiado largos', () => {
    expect(() => normalizarDetalle({ servicio: 'x'.repeat(201) })).toThrow(ErrorPlanificacion)
    expect(() => normalizarDetalle({ detalle: 'x'.repeat(1001) })).toThrow('hasta 1000 caracteres')
  })
})

describe('fechaHoraValida', () => {
  it('acepta fechas y horas reales en minutos', () => {
    expect(fechaHoraValida('2026-11-26T15:30')).toBe(true)
    expect(fechaHoraValida('2028-02-29T00:00')).toBe(true)
  })
  it('rechaza formatos y fechas que no existen', () => {
    for (const s of ['2026-02-31T10:00', '2026-11-26T24:00', '2026-11-26T10:60', '2026-11-26', '2026-11-26 10:00', '']) {
      expect(fechaHoraValida(s)).toBe(false)
    }
  })
})

describe('validarPlan', () => {
  it('ordena las parciales por hora y limpia notas y la hora total vacía', () => {
    expect(
      validarPlan(
        {
          entrega: '',
          parciales: [
            { planificada: '2026-11-28T10:00', cantidad: 60, nota: '  resto ' },
            { planificada: '2026-11-26T09:30', cantidad: 40, nota: '' },
          ],
        },
        100,
      ),
    ).toEqual({
      parciales: [
        { planificada: '2026-11-26T09:30', cantidad: 40 },
        { planificada: '2026-11-28T10:00', cantidad: 60, nota: 'resto' },
      ],
    })
  })
  it('las parciales pueden no tener cantidad, y la hora del trabajo se conserva', () => {
    expect(validarPlan({ entrega: '2026-11-27T15:00', parciales: [{ planificada: '2026-11-26T12:00' }] }, 5)).toEqual({
      entrega: '2026-11-27T15:00',
      parciales: [{ planificada: '2026-11-26T12:00' }],
    })
  })
  it('rechaza horas inválidas, cantidades no enteras y sumas mayores que el trabajo', () => {
    expect(() => validarPlan({ entrega: '2026-13-01T10:00', parciales: [] }, 1)).toThrow('entrega del trabajo')
    expect(() => validarPlan({ parciales: [{ planificada: 'mañana' }] }, 1)).toThrow('entrega parcial 1')
    expect(() => validarPlan({ parciales: [{ planificada: '2026-11-26T10:00', cantidad: 0 }] }, 1)).toThrow('mayor que cero')
    expect(() => validarPlan({ parciales: [{ planificada: '2026-11-26T10:00', cantidad: 1.5 }] }, 5)).toThrow(ErrorPlanificacion)
    expect(() =>
      validarPlan({ parciales: [{ planificada: '2026-11-26T10:00', cantidad: 60 }, { planificada: '2026-11-27T10:00', cantidad: 50 }] }, 100),
    ).toThrow('Las entregas parciales suman 110 unidades, pero el trabajo tiene 100.')
    expect(() => validarPlan({ parciales: [{ planificada: '2026-11-26T10:00', nota: 'x'.repeat(201) }] }, 1)).toThrow('nota')
    expect(() => validarPlan({ parciales: Array.from({ length: 51 }, () => ({ planificada: '2026-11-26T10:00' })) }, 1)).toThrow('hasta 50')
  })
})

describe('etiquetas y hora de Chile', () => {
  it('etiquetaPlanificada muestra día, fecha y hora; acepta segundos de la base', () => {
    expect(etiquetaPlanificada('2026-11-26T15:00')).toBe('jue 26/11 15:00')
    expect(etiquetaPlanificada('2026-11-30T08:05:00')).toBe('lun 30/11 08:05')
    expect(etiquetaPlanificada('raro')).toBe('raro')
  })
  it('fechaHoraSantiago pasa un instante a hora de reloj de Chile (verano, UTC-3)', () => {
    expect(fechaHoraSantiago('2026-11-25T17:22:58Z')).toBe('2026-11-25T14:22')
    expect(fechaHoraSantiago('2026-11-26T02:30:00Z')).toBe('2026-11-25T23:30')
  })
})

describe('planesPorTrabajo y resumenPlan', () => {
  const t = (id: string, entregaPlanificada?: string): Trabajo => ({
    id, numero: 1, clienteId: 'c', area: 'encuadernacion', entrada: 'cliente', salida: 'cliente', recibidoEn: '2026-11-20T12:00:00Z', urgente: false,
    ...(entregaPlanificada ? { entregaPlanificada } : {}),
  })
  const parciales: EntregaParcial[] = [
    { id: 'p2', trabajoId: 't1', planificada: '2026-11-27T10:00', cantidad: 60 },
    { id: 'p1', trabajoId: 't1', planificada: '2026-11-26T10:00', cantidad: 40 },
    { id: 'px', trabajoId: 'otro', planificada: '2026-11-26T10:00' },
  ]

  it('agrupa por trabajo, ordena por hora y descarta parciales de trabajos que no están', () => {
    const planes = planesPorTrabajo([t('t1', '2026-11-28T15:00'), t('t2')], parciales)
    expect(planes.get('t1')).toEqual({ entrega: '2026-11-28T15:00', parciales: [parciales[1], parciales[0]] })
    expect(planes.has('t2')).toBe(false)
    expect(planes.has('otro')).toBe(false)
  })

  it('resume la próxima parcial pendiente y la hora del trabajo completo', () => {
    const plan = planesPorTrabajo([t('t1', '2026-11-28T15:00')], parciales).get('t1')
    expect(resumenPlan(plan, '2026-11-25T09:00')).toBe('Parcial: jue 26/11 10:00 (40 u.) · Total: sáb 28/11 15:00')
    expect(resumenPlan(plan, '2026-11-26T11:00')).toBe('Parcial: vie 27/11 10:00 (60 u.) · Total: sáb 28/11 15:00')
    expect(resumenPlan(plan, '2026-11-29T11:00')).toBe('Total: sáb 28/11 15:00')
    expect(resumenPlan(undefined, '2026-11-25T09:00')).toBeUndefined()
  })

  it('sin hora total y con todas las parciales pasadas, muestra la última', () => {
    const plan = planesPorTrabajo([t('t1')], parciales).get('t1')
    expect(resumenPlan(plan, '2026-11-30T00:00')).toBe('Parcial: vie 27/11 10:00')
  })
})

describe('permisos de detalle y planificación', () => {
  it('detallan gestión y los operarios de su área', () => {
    expect(puedeDetallar('jefe_taller', 'afilado')).toBe(true)
    expect(puedeDetallar('operario_afilado', 'afilado')).toBe(true)
    expect(puedeDetallar('operario_afilado', 'encuadernacion')).toBe(false)
    expect(puedeDetallar('chofer', 'afilado')).toBe(false)
  })
  it('planifican gestión y operarios de encuadernación', () => {
    expect(puedePlanificar('secretaria')).toBe(true)
    expect(puedePlanificar('operario_encuadernacion')).toBe(true)
    expect(puedePlanificar('operario_afilado')).toBe(false)
    expect(puedePlanificar('chofer')).toBe(false)
  })
})
