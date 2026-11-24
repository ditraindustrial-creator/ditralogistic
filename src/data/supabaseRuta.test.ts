import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { crearRepoConCliente, errorDeEntrega, errorDeVisita, filaAVisita } from './supabaseRepo'
import { ErrorEntrega } from '../dominio/entrega'
import { ErrorVisita } from '../dominio/ruta'

type Fila = Record<string, unknown>
type Resp = { data?: unknown; error: { code?: string; message: string; statusCode?: string } | null }

/** Cliente Supabase falso para lo que usan los métodos de la ruta; registra cada llamada. */
function crearFalso(op: {
  visitas?: Fila[]
  tope?: number
  rpc?: Resp
  upsert?: Resp
  update?: Resp
} = {}) {
  const log: { tipo: string; args: unknown[] }[] = []
  const visitas = op.visitas ?? []
  const sb = {
    rpc(...args: unknown[]) {
      log.push({ tipo: 'rpc', args })
      return Promise.resolve(op.rpc ?? { data: null, error: null })
    },
    from(tabla: string) {
      return {
        select(cols: string) {
          const filtros: [string, unknown][] = []
          const q = {
            eq(c: string, v: unknown) {
              filtros.push([c, v])
              return q
            },
            order(c: string) {
              return {
                range(d: number, h: number) {
                  log.push({ tipo: 'select', args: [tabla, cols, [...filtros], c, d, h] })
                  const filas = visitas
                    .filter((f) => filtros.every(([k, v]) => f[k] === v))
                    .sort((a, b) => String(a[c]).localeCompare(String(b[c])))
                  return Promise.resolve({ data: filas.slice(d, Math.min(h + 1, d + (op.tope ?? 1000))), error: null })
                },
              }
            },
          }
          return q
        },
        upsert(fila: Fila, opciones: unknown) {
          log.push({ tipo: 'upsert', args: [tabla, fila, opciones] })
          return Promise.resolve(op.upsert ?? { error: null })
        },
        update(valores: Fila) {
          return {
            eq(c: string, v: unknown) {
              return {
                select(cols: string) {
                  log.push({ tipo: 'update', args: [tabla, valores, c, v, cols] })
                  return Promise.resolve(op.update ?? { data: [{ id: v }], error: null })
                },
              }
            },
          }
        },
      }
    },
  }
  return { repo: crearRepoConCliente(sb as unknown as SupabaseClient), log }
}

describe('supabaseRepo.entregarUnidades', () => {
  it('una sola llamada a entregar_unidades con las líneas en snake_case y el documento sin espacios', async () => {
    const { repo, log } = crearFalso()
    await repo.entregarUnidades([{ lineaId: 'l1', cantidad: 3 }, { lineaId: 'l2', cantidad: 1 }], ' 4521 ')
    expect(log).toEqual([{
      tipo: 'rpc',
      args: ['entregar_unidades', { p_entregas: [{ linea_id: 'l1', cantidad: 3 }, { linea_id: 'l2', cantidad: 1 }], p_documento: '4521' }],
    }])
  })
  it('valida antes de llamar a la base', async () => {
    const { repo, log } = crearFalso()
    await expect(repo.entregarUnidades([{ lineaId: 'l1', cantidad: 0 }], '1')).rejects.toThrow(ErrorEntrega)
    await expect(repo.entregarUnidades([{ lineaId: 'l1', cantidad: 1 }], ' ')).rejects.toThrow('Anota el número de guía o factura.')
    await expect(repo.entregarUnidades([], '1')).rejects.toThrow('Indica qué entregar.')
    expect(log).toEqual([])
  })
  it('los errores de la base llegan en español', async () => {
    const { repo } = crearFalso({ rpc: { error: { code: 'P0001', message: '«Tijera» tiene 1 unidad lista; no se pueden entregar 2 (faltan 1).' } } })
    await expect(repo.entregarUnidades([{ lineaId: 'l1', cantidad: 2 }], '1')).rejects.toThrow(
      new ErrorEntrega('«Tijera» tiene 1 unidad lista; no se pueden entregar 2 (faltan 1).'),
    )
  })
})

describe('errorDeEntrega', () => {
  it('reglas (P0001) y avisos de permiso conocidos pasan tal cual; lo demás se traduce', () => {
    expect(errorDeEntrega({ code: 'P0001', message: 'La línea no existe.' })).toEqual(new ErrorEntrega('La línea no existe.'))
    expect(errorDeEntrega({ code: '42501', message: 'Debes iniciar sesión para registrar entregas.' }).message).toBe(
      'Debes iniciar sesión para registrar entregas.',
    )
    expect(errorDeEntrega({ code: '42501', message: 'new row violates row-level security policy for table "movimientos"' }).message).toBe(
      'No tienes permiso para registrar entregas.',
    )
    expect(errorDeEntrega({ code: '40P01', message: 'deadlock detected' }).message).toBe(
      'Otra persona estaba registrando una entrega de estas mismas líneas. Inténtalo de nuevo.',
    )
    const red = errorDeEntrega({ code: '08006', message: 'connection failure' })
    expect(red).not.toBeInstanceOf(ErrorEntrega)
    expect(red.message).toBe('No se pudo registrar la entrega. Revisa tu conexión e inténtalo de nuevo.')
  })
})

describe('supabaseRepo: visitas', () => {
  const fila = (id: string, fecha: string): Fila => ({
    id, fecha, cliente_id: 'c1', recorrido_id: null, confirmada: 'no', requiere_confirmacion: false, solicitada: true, nota: null,
  })

  it('filaAVisita convierte nulls en ausentes', () => {
    expect(filaAVisita({
      id: 'v', fecha: '2026-11-24', cliente_id: 'c', recorrido_id: 'r', confirmada: 'si', requiere_confirmacion: true, solicitada: false, nota: 'n',
    })).toEqual({ id: 'v', fecha: '2026-11-24', clienteId: 'c', recorridoId: 'r', confirmada: 'si', requiereConfirmacion: true, solicitada: false, nota: 'n' })
    expect(filaAVisita(fila('v', '2026-11-24') as never)).not.toHaveProperty('nota')
  })

  it('listarVisitas filtra por fecha y lee por páginas aunque el servidor corte antes', async () => {
    const visitas = [...Array.from({ length: 5 }, (_, i) => fila(`v${i}`, '2026-11-24')), fila('otra', '2026-11-25')]
    const { repo, log } = crearFalso({ visitas, tope: 2 })
    const r = await repo.listarVisitas('2026-11-24')
    expect(r.map((v) => v.id)).toEqual(['v0', 'v1', 'v2', 'v3', 'v4'])
    expect(log.every((l) => l.tipo === 'select' && (l.args[2] as unknown[]).length === 1)).toBe(true)
    expect(log).toHaveLength(4) // 2 + 2 + 1 + página vacía
  })

  it('listarVisitas rechaza una fecha inválida sin consultar', async () => {
    const { repo, log } = crearFalso()
    await expect(repo.listarVisitas('24/11/2026')).rejects.toThrow(new ErrorVisita('La fecha no es válida.'))
    expect(log).toEqual([])
  })

  it('marcarVisita es un upsert sobre (fecha, cliente) que solo envía la confirmación', async () => {
    const { repo, log } = crearFalso()
    await repo.marcarVisita('2026-11-24', 'c1', 'si')
    expect(log).toEqual([{
      tipo: 'upsert', args: ['visitas', { fecha: '2026-11-24', cliente_id: 'c1', confirmada: 'si' }, { onConflict: 'fecha,cliente_id' }],
    }])
  })

  it('agregarVisitaExtra marca solicitada y guarda la nota recortada (o null)', async () => {
    const { repo, log } = crearFalso()
    await repo.agregarVisitaExtra('2026-11-24', 'c1', '  Llamó ')
    await repo.agregarVisitaExtra('2026-11-25', 'c1')
    expect(log.map((l) => l.args[1])).toEqual([
      { fecha: '2026-11-24', cliente_id: 'c1', solicitada: true, nota: 'Llamó' },
      { fecha: '2026-11-25', cliente_id: 'c1', solicitada: true, nota: null },
    ])
  })

  it('valida antes de escribir (fin de semana) y traduce los errores de la base', async () => {
    const { repo, log } = crearFalso({ upsert: { error: { code: '42501', message: 'new row violates row-level security policy for table "visitas"' } } })
    await expect(repo.marcarVisita('2026-11-28', 'c1', 'si')).rejects.toThrow('Las rutas son de lunes a viernes.')
    expect(log).toEqual([])
    await expect(repo.marcarVisita('2026-11-24', 'c1', 'si')).rejects.toThrow(new ErrorVisita('No tienes permiso para modificar las visitas.'))
  })

  it('errorDeVisita', () => {
    expect(errorDeVisita({ code: '23503', message: 'fk' }).message).toBe('El cliente no existe.')
    expect(errorDeVisita({ code: '23514', message: 'violates check constraint "visitas_dia_habil"' }).message).toBe(
      'Las rutas son de lunes a viernes.',
    )
    expect(errorDeVisita({ code: '23514', message: 'violates check constraint "visitas_nota_largo"' }).message).toBe(
      'La nota puede tener hasta 200 caracteres.',
    )
    expect(errorDeVisita({ code: '22007', message: 'invalid input syntax for type date' }).message).toBe('La fecha no es válida.')
    const red = errorDeVisita({ message: 'Failed to fetch' })
    expect(red).not.toBeInstanceOf(ErrorVisita)
    expect(red.message).toBe('No se pudo guardar la visita. Revisa tu conexión e inténtalo de nuevo.')
  })
})

describe('supabaseRepo.actualizarSalida', () => {
  it('actualiza solo la salida del trabajo', async () => {
    const { repo, log } = crearFalso()
    await repo.actualizarSalida('t1', 'cliente')
    expect(log).toEqual([{ tipo: 'update', args: ['trabajos', { salida: 'cliente' }, 'id', 't1', 'id'] }])
  })
  it('sin filas actualizadas (RLS o inexistente) avisa; modalidad inválida no consulta', async () => {
    const { repo, log } = crearFalso({ update: { data: [], error: null } })
    await expect(repo.actualizarSalida('t1', 'cliente')).rejects.toThrow(
      'No se pudo cambiar la salida (el trabajo no existe o no tienes permiso).',
    )
    await expect(repo.actualizarSalida('t1', 'volando' as never)).rejects.toThrow('La modalidad de salida no es válida.')
    expect(log).toHaveLength(1)
  })
  it('un error de la base no se muestra en inglés', async () => {
    const { repo } = crearFalso({ update: { error: { code: '42501', message: 'Solo puedes cambiar la salida y la guía de despacho de un trabajo.' } } })
    await expect(repo.actualizarSalida('t1', 'cliente')).rejects.toThrow('No tienes permiso para cambiar la salida.')
    const { repo: r2 } = crearFalso({ update: { error: { message: 'Failed to fetch' } } })
    await expect(r2.actualizarSalida('t1', 'cliente')).rejects.toThrow('No se pudo cambiar la salida. Revisa tu conexión e inténtalo de nuevo.')
  })
})
