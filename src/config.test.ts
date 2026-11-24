import { describe, it, expect } from 'vitest'
import { leerConfig } from './config'

describe('leerConfig', () => {
  it('devuelve la config cuando están ambas variables', () => {
    expect(leerConfig({ VITE_SUPABASE_URL: 'https://x.supabase.co', VITE_SUPABASE_ANON_KEY: 'k' })).toEqual({
      ok: true,
      config: { url: 'https://x.supabase.co', anonKey: 'k' },
    })
  })
  it('nombra las variables faltantes', () => {
    expect(leerConfig({})).toEqual({ ok: false, faltantes: ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'] })
    expect(leerConfig({ VITE_SUPABASE_URL: 'u', VITE_SUPABASE_ANON_KEY: '  ' })).toEqual({
      ok: false,
      faltantes: ['VITE_SUPABASE_ANON_KEY'],
    })
  })
})
