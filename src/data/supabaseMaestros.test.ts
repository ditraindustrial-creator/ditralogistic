import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { crearRepoConCliente, errorDeCliente, leerTodas } from './supabaseRepo'
import { ErrorCliente } from '../dominio/maestros'

type Fila = Record<string, unknown>

/** Cliente Supabase falso: respeta range(), un tope de filas por respuesta (como PostgREST), el RUT único y onConflict. */
function crearFalso(tablas: Record<string, Fila[]>, tope = 1000) {
  const llamadas = { select: 0, insert: 0, upsert: 0, update: 0 }
  const rows = (t: string) => tablas[t]
  const sb = {
    from(t: string) {
      return {
        select() {
          return {
            order(col: string) {
              return {
                range(d: number, h: number) {
                  llamadas.select++
                  const orden = [...rows(t)].sort((a, b) => String(a[col]).localeCompare(String(b[col])))
                  return Promise.resolve({ data: orden.slice(d, Math.min(h + 1, d + tope)), error: null })
                },
              }
            },
          }
        },
        insert(nuevas: Fila[]) {
          llamadas.insert++
          for (const n of nuevas) {
            if (t === 'clientes' && rows(t).some((r) => r.rut === n.rut)) {
              return Promise.resolve({ error: { code: '23505', message: 'duplicate key' } })
            }
            rows(t).push({ id: `n${rows(t).length}`, ...n })
          }
          return Promise.resolve({ error: null })
        },
        upsert(filas: Fila[], opciones: { onConflict: string }) {
          llamadas.upsert++
          const k = opciones.onConflict
          for (const f of filas) {
            const e = rows(t).find((r) => r[k] === f[k])
            if (e) Object.assign(e, f)
            else rows(t).push({ id: `n${rows(t).length}`, ...f })
          }
          return Promise.resolve({ error: null })
        },
        update() {
          llamadas.update++
          return { eq: () => Promise.resolve({ error: null }) }
        },
      }
    },
  }
  return { sb: sb as unknown as SupabaseClient, llamadas }
}

const pad = (i: number) => String(i).padStart(5, '0')
function clientesBase(n: number): Fila[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `id-${pad(i)}`, nombre: `Cliente ${i}`, rut: `${i + 1}-9`, contacto: null, direccion: null, recorrido_id: 'rec-1',
  }))
}

describe('leerTodas', () => {
  it('sigue pidiendo páginas hasta que llegan vacías, aunque el servidor tenga un tope menor que la página', async () => {
    const datos = Array.from({ length: 250 }, (_, i) => i)
    const pedidos: [number, number][] = []
    const r = await leerTodas<number>((d, h) => {
      pedidos.push([d, h])
      return Promise.resolve({ data: datos.slice(d, Math.min(h + 1, d + 100)), error: null })
    })
    expect(r).toEqual(datos)
    expect(pedidos[0]).toEqual([0, 999])
  })
  it('propaga el error', async () => {
    await expect(leerTodas(() => Promise.resolve({ data: null, error: { message: 'x' } }))).rejects.toThrow('x')
  })
})

describe('supabaseRepo con más filas que el tope de PostgREST', () => {
  it('listarClientes y listarProductos leen las 2500 filas con tope de 1000', async () => {
    const productos = Array.from({ length: 2500 }, (_, i) => ({ id: `p-${pad(i)}`, codigo: `C${pad(i)}`, nombre: 'x', area: 'afilado' }))
    const { sb } = crearFalso({ clientes: clientesBase(2500), productos })
    const repo = crearRepoConCliente(sb)
    expect(await repo.listarClientes()).toHaveLength(2500)
    expect(new Set((await repo.listarClientes()).map((c) => c.id)).size).toBe(2500)
    expect(await repo.listarProductos()).toHaveLength(2500)
  })

  it('re-importar 2500 clientes existentes no inserta ni actualiza nada', async () => {
    const { sb, llamadas } = crearFalso({ clientes: clientesBase(2500) })
    const repo = crearRepoConCliente(sb)
    const entrantes = clientesBase(2500).map((f) => ({ nombre: f.nombre as string, rut: f.rut as string }))
    expect(await repo.guardarClientes(entrantes)).toEqual({ creados: 0, actualizados: 0, sinCambios: 2500 })
    expect(llamadas.insert + llamadas.upsert + llamadas.update).toBe(0)
  })

  it('1200 clientes con cambios se escriben en 3 upserts por id, no en 1200 updates, y no tocan el recorrido', async () => {
    const tablas = { clientes: clientesBase(1200) }
    const { sb, llamadas } = crearFalso(tablas)
    const repo = crearRepoConCliente(sb)
    const entrantes = clientesBase(1200).map((f) => ({ nombre: `${f.nombre} (nuevo)`, rut: f.rut as string }))
    expect(await repo.guardarClientes(entrantes)).toEqual({ creados: 0, actualizados: 1200, sinCambios: 0 })
    expect(llamadas.upsert).toBe(3)
    expect(llamadas.update).toBe(0)
    expect(tablas.clientes.every((f) => f.recorrido_id === 'rec-1' && String(f.nombre).endsWith('(nuevo)'))).toBe(true)
  })

  it('filas con distintas columnas informadas van en lotes separados (no se pisan con null)', async () => {
    const tablas = { clientes: clientesBase(2).map((f, i) => ({ ...f, contacto: i === 0 ? 'Ana' : null })) }
    const { sb, llamadas } = crearFalso(tablas)
    const repo = crearRepoConCliente(sb)
    await repo.guardarClientes([
      { nombre: 'A2', rut: '1-9' },
      { nombre: 'B2', rut: '2-9', contacto: 'Beto' },
    ])
    expect(llamadas.upsert).toBe(2)
    expect(tablas.clientes[0]).toMatchObject({ nombre: 'A2', contacto: 'Ana' })
    expect(tablas.clientes[1]).toMatchObject({ nombre: 'B2', contacto: 'Beto' })
  })

  it('un cliente más allá de la fila 1000 ya no se toma por nuevo (antes chocaba con el RUT único)', async () => {
    const { sb, llamadas } = crearFalso({ clientes: clientesBase(1500) })
    const repo = crearRepoConCliente(sb)
    expect(await repo.guardarClientes([{ nombre: 'Cliente 1400', rut: '1401-9' }])).toEqual({ creados: 0, actualizados: 0, sinCambios: 1 })
    expect(llamadas.insert).toBe(0)
  })
})

describe('supabaseRepo.crearCliente', () => {
  function falsoInsert(respuesta: { data: unknown; error: { code?: string; message: string } | null }) {
    const log: unknown[] = []
    const sb = {
      from: (t: string) => ({
        insert: (fila: unknown) => {
          log.push([t, fila])
          return { select: (cols: string) => ({ single: () => { log.push(cols); return Promise.resolve(respuesta) } }) }
        },
      }),
    }
    return { repo: crearRepoConCliente(sb as unknown as SupabaseClient), log }
  }
  it('inserta el cliente validado (RUT normalizado) y devuelve la fila creada', async () => {
    const fila = { id: 'n1', nombre: 'Ferretería', rut: '12345678-5', contacto: null, direccion: 'Calle 1', recorrido_id: 'r1' }
    const { repo, log } = falsoInsert({ data: fila, error: null })
    const c = await repo.crearCliente({ nombre: ' Ferretería ', rut: '12.345.678-5', direccion: 'Calle 1', recorridoId: 'r1' })
    expect(c).toEqual({ id: 'n1', nombre: 'Ferretería', rut: '12345678-5', direccion: 'Calle 1', recorridoId: 'r1' })
    expect(log[0]).toEqual(['clientes', { nombre: 'Ferretería', rut: '12345678-5', contacto: null, direccion: 'Calle 1', recorrido_id: 'r1' }])
  })
  it('no llama a la base si los datos no son válidos', async () => {
    const { repo, log } = falsoInsert({ data: null, error: null })
    await expect(repo.crearCliente({ nombre: 'X', rut: 'abc' })).rejects.toThrow('no es válido')
    expect(log).toEqual([])
  })
  it('el RUT repetido (índice único) y los demás errores llegan en español, nunca el mensaje técnico', async () => {
    const dup = falsoInsert({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "clientes_rut_unico"' } })
    await expect(dup.repo.crearCliente({ nombre: 'X', rut: '1-9' })).rejects.toThrow(
      new ErrorCliente('Ya existe un cliente con ese RUT. Búscalo por nombre o RUT en vez de crearlo de nuevo.'),
    )
    expect(errorDeCliente({ code: '42501', message: 'new row violates row-level security policy for table "clientes"' }).message).toBe(
      'No tienes permiso para crear clientes.',
    )
    expect(errorDeCliente({ code: '42501', message: 'permission denied for table clientes' }).message).toBe('No tienes permiso para crear clientes.')
    expect(errorDeCliente({ message: 'TypeError: Failed to fetch' }).message).toBe(
      'No se pudo guardar el cliente. Revisa tu conexión e inténtalo de nuevo.',
    )
  })
})
