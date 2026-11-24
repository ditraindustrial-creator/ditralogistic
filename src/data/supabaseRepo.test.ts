import { describe, it, expect } from 'vitest'
import { filaAMovimiento, errorDeMovimiento } from './supabaseRepo'
import { ErrorMovimiento } from '../dominio/avance'

describe('filaAMovimiento', () => {
  it('convierte la fila de mover_unidades al tipo Movimiento', () => {
    expect(
      filaAMovimiento({
        id: 'm1', linea_id: 'l1', cantidad: 4, etapa_origen_id: 'a', etapa_destino_id: 'b',
        usuario_id: 'u1', creado_en: '2026-11-24T10:00:00+00:00',
      }),
    ).toEqual({
      id: 'm1', lineaId: 'l1', cantidad: 4, etapaOrigenId: 'a', etapaDestinoId: 'b',
      usuarioId: 'u1', creadoEn: '2026-11-24T10:00:00+00:00',
    })
  })
})

describe('errorDeMovimiento', () => {
  it('las reglas de la base (P0001) y permisos (42501) llegan como ErrorMovimiento con su mensaje', () => {
    const e = errorDeMovimiento({ code: 'P0001', message: 'Solo hay 2 unidades en esta etapa; no se pueden mover 3.' })
    expect(e).toBeInstanceOf(ErrorMovimiento)
    expect(e.message).toBe('Solo hay 2 unidades en esta etapa; no se pueden mover 3.')
    expect(errorDeMovimiento({ code: '42501', message: 'No tienes permiso para mover unidades de esta área.' })).toBeInstanceOf(
      ErrorMovimiento,
    )
  })
  it('una violación de RLS genérica se traduce a español', () => {
    const e = errorDeMovimiento({ code: '42501', message: 'new row violates row-level security policy for table "movimientos"' })
    expect(e.message).toBe('No tienes permiso para mover unidades de esta línea.')
  })
  it('una cantidad no entera se informa en español', () => {
    expect(errorDeMovimiento({ code: '22P02', message: 'invalid input syntax for type integer: "1.5"' }).message).toBe(
      'La cantidad debe ser un número entero mayor que cero.',
    )
  })
  it('otros errores dan un mensaje genérico', () => {
    const e = errorDeMovimiento({ code: '08006', message: 'connection failure' })
    expect(e).not.toBeInstanceOf(ErrorMovimiento)
    expect(e.message).toBe('No se pudo registrar el movimiento. Revisa tu conexión e inténtalo de nuevo.')
  })
})
