import { describe, it, expect, afterEach, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useFechaPorDefecto } from './useFechaPorDefecto'
import { siguienteDiaHabil } from '../dominio/fechas'

function volverAPantalla() {
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('useFechaPorDefecto', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('a medianoche de Santiago (verano, UTC-3) pasa sola al día nuevo', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    vi.setSystemTime(new Date('2026-11-25T02:59:00Z')) // martes 24, 23:59 en Santiago
    const { result } = renderHook(() => useFechaPorDefecto((hoy) => hoy))
    expect(result.current[0]).toBe('2026-11-24')
    act(() => vi.advanceTimersByTime(30_000))
    expect(result.current[0]).toBe('2026-11-24')
    act(() => vi.advanceTimersByTime(31_000)) // 00:00:01 + margen
    expect(result.current[0]).toBe('2026-11-25')
  })

  it('el cálculo usa el día de Santiago: la ruta de mañana pasa del miércoles al jueves', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    vi.setSystemTime(new Date('2026-11-25T02:00:00Z')) // martes 24, 23:00
    const { result } = renderHook(() => useFechaPorDefecto(siguienteDiaHabil))
    expect(result.current[0]).toBe('2026-11-25')
    act(() => vi.advanceTimersByTime(3_602_000))
    expect(result.current[0]).toBe('2026-11-26')
  })

  it('al volver a la pantalla (app abierta de un día para otro) recalcula; con el cambio de hora de septiembre también', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    vi.setSystemTime(new Date('2026-09-05T20:00:00Z')) // sábado 5
    const { result } = renderHook(() => useFechaPorDefecto((hoy) => hoy))
    expect(result.current[0]).toBe('2026-09-05')
    vi.setSystemTime(new Date('2026-09-06T04:30:00Z')) // domingo 6, 01:30 (se saltó la medianoche), sin que corran temporizadores
    act(() => volverAPantalla())
    expect(result.current[0]).toBe('2026-09-06')
  })

  it('si el usuario eligió una fecha, no se la cambia', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    vi.setSystemTime(new Date('2026-11-25T02:59:00Z'))
    const { result } = renderHook(() => useFechaPorDefecto((hoy) => hoy))
    act(() => result.current[1]('2026-11-20'))
    act(() => vi.advanceTimersByTime(2 * 86_400_000))
    act(() => volverAPantalla())
    expect(result.current[0]).toBe('2026-11-20')
  })

  it('al desmontar no deja temporizadores ni oyentes', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const quitar = vi.spyOn(document, 'removeEventListener')
    const { unmount } = renderHook(() => useFechaPorDefecto((hoy) => hoy))
    unmount()
    expect(vi.getTimerCount()).toBe(0)
    expect(quitar).toHaveBeenCalledWith('visibilitychange', expect.any(Function))
  })
})
