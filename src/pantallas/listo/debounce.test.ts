import { describe, it, expect, vi, afterEach } from 'vitest'
import { crearDebounce } from './debounce'

afterEach(() => vi.useRealTimers())

describe('crearDebounce', () => {
  it('junta una ráfaga en una sola llamada tras la espera', () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    const d = crearDebounce(fn, 400)
    d.llamar(); vi.advanceTimersByTime(300); d.llamar(); vi.advanceTimersByTime(300); d.llamar()
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(399)
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(fn).toHaveBeenCalledTimes(1)
  })
  it('cancelar descarta la llamada pendiente', () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    const d = crearDebounce(fn, 400)
    d.llamar(); d.cancelar()
    vi.advanceTimersByTime(1000)
    expect(fn).not.toHaveBeenCalled()
  })
})
