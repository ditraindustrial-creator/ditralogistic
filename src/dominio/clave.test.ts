import { describe, it, expect } from 'vitest'
import { nuevaClave } from './clave'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('nuevaClave', () => {
  it('usa crypto.randomUUID cuando existe', () => {
    expect(nuevaClave({ randomUUID: () => '11111111-1111-4111-8111-111111111111' })).toBe('11111111-1111-4111-8111-111111111111')
  })
  it('sin randomUUID (navegador viejo o http) arma un uuid v4 con getRandomValues', () => {
    const c = nuevaClave({ getRandomValues: <T extends ArrayBufferView | null>(a: T) => { new Uint8Array(a!.buffer).fill(0xff); return a } })
    expect(c).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff')
    expect(c).toMatch(UUID)
  })
  it('sin crypto usa Math.random y igual da un uuid v4 válido', () => {
    const c = nuevaClave(undefined)
    expect(c).toMatch(UUID)
    expect(nuevaClave(undefined)).not.toBe(c)
  })
  it('por defecto usa el crypto del entorno', () => {
    expect(nuevaClave()).toMatch(UUID)
  })
})
