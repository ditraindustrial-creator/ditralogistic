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
  upload?: Resp
  firma?: { data: { signedUrl: string } | null; error: { message: string; statusCode?: string } | null }
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
    storage: {
      from(bucket: string) {
        return {
          upload(ruta: string, archivo: File, opciones: unknown) {
            log.push({ tipo: 'upload', args: [bucket, ruta, archivo, opciones] })
            return Promise.resolve(op.upload ?? { data: { path: ruta }, error: null })
          },
          createSignedUrl(ruta: string, segundos: number) {
            log.push({ tipo: 'firma', args: [bucket, ruta, segundos] })
            return Promise.resolve(op.firma ?? { data: { signedUrl: 'https://x.supabase.co/firmada?token=abc' }, error: null })
          },
          remove(rutas: string[]) {
            log.push({ tipo: 'remove', args: [bucket, rutas] })
            return Promise.resolve({ data: [], error: null })
          },
        }
      },
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
    const { repo } = crearFalso({ update: { error: { code: '42501', message: 'Solo puedes cambiar la salida, la guía de despacho y la foto del documento de un trabajo.' } } })
    await expect(repo.actualizarSalida('t1', 'cliente')).rejects.toThrow('No tienes permiso para cambiar la salida.')
    const { repo: r2 } = crearFalso({ update: { error: { message: 'Failed to fetch' } } })
    await expect(r2.actualizarSalida('t1', 'cliente')).rejects.toThrow('No se pudo cambiar la salida. Revisa tu conexión e inténtalo de nuevo.')
  })
})

describe('supabaseRepo.subirFotoDocumento', () => {
  const foto = (type = 'image/jpeg', bytes = 10) => new File([new Uint8Array(bytes)], 'IMG 001.JPG', { type })

  it('sube al bucket documentos con nombre generado en la carpeta del trabajo y guarda la ruta', async () => {
    const { repo, log } = crearFalso()
    const archivo = foto()
    const ruta = await repo.subirFotoDocumento('t1', archivo)
    expect(ruta).toMatch(/^t1\/[0-9a-z-]+\.jpg$/)
    expect(log).toEqual([
      { tipo: 'upload', args: ['documentos', ruta, archivo, { contentType: 'image/jpeg', upsert: false }] },
      { tipo: 'update', args: ['trabajos', { foto_documento: ruta }, 'id', 't1', 'id'] },
    ])
    const otra = await repo.subirFotoDocumento('t1', foto())
    expect(otra).not.toBe(ruta)
  })

  it('valida tipo y tamaño antes de subir', async () => {
    const { repo, log } = crearFalso()
    await expect(repo.subirFotoDocumento('t1', foto('application/pdf'))).rejects.toThrow('La foto debe ser JPG, PNG, WebP o HEIC.')
    await expect(repo.subirFotoDocumento('t1', foto('image/png', 8 * 1024 * 1024 + 1))).rejects.toThrow('La foto puede pesar hasta 8 MB.')
    expect(log).toEqual([])
  })

  it('si Storage rechaza la subida, mensaje en español y no toca el trabajo', async () => {
    const { repo, log } = crearFalso({ upload: { error: { statusCode: '403', message: 'new row violates row-level security policy' } } })
    await expect(repo.subirFotoDocumento('t1', foto())).rejects.toThrow(new ErrorEntrega('No tienes permiso para subir la foto del documento.'))
    expect(log.map((l) => l.tipo)).toEqual(['upload'])
    const { repo: r2 } = crearFalso({ upload: { error: { message: 'Failed to fetch' } } })
    await expect(r2.subirFotoDocumento('t1', foto())).rejects.toThrow('No se pudo subir la foto. Revisa tu conexión e inténtalo de nuevo.')
  })

  it('si no se puede guardar la ruta en el trabajo, borra la foto subida', async () => {
    const { repo, log } = crearFalso({ update: { data: [], error: null } })
    await expect(repo.subirFotoDocumento('t1', foto())).rejects.toThrow(
      'No se pudo asociar la foto al trabajo (el trabajo no existe o no tienes permiso).',
    )
    expect(log.map((l) => l.tipo)).toEqual(['upload', 'update', 'remove'])
    expect(log[2].args).toEqual(['documentos', [log[0].args[1]]])
  })
})

describe('supabaseRepo.urlFotoDocumento', () => {
  it('pide una URL firmada de unos 5 minutos del bucket documentos', async () => {
    const { repo, log } = crearFalso()
    expect(await repo.urlFotoDocumento('t1/abc.jpg')).toBe('https://x.supabase.co/firmada?token=abc')
    expect(log).toEqual([{ tipo: 'firma', args: ['documentos', 't1/abc.jpg', 300] }])
  })
  it('errores en español: sin permiso, no existe y red', async () => {
    const { repo: r1 } = crearFalso({ firma: { data: null, error: { statusCode: '403', message: 'new row violates row-level security policy' } } })
    await expect(r1.urlFotoDocumento('t1/a.jpg')).rejects.toThrow('No tienes permiso para ver la foto del documento.')
    const { repo: r2 } = crearFalso({ firma: { data: null, error: { statusCode: '404', message: 'Object not found' } } })
    await expect(r2.urlFotoDocumento('t1/a.jpg')).rejects.toThrow('No se encontró la foto del documento.')
    const { repo: r3 } = crearFalso({ firma: { data: null, error: { message: 'Failed to fetch' } } })
    await expect(r3.urlFotoDocumento('t1/a.jpg')).rejects.toThrow('No se pudo abrir la foto. Revisa tu conexión e inténtalo de nuevo.')
  })
})
