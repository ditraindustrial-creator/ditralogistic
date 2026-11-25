import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { crearRepoConCliente, errorDeAsignaciones, errorDeCliente, filaARecorrido, leerTodas } from './supabaseRepo'
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
    id: `id-${pad(i)}`, nombre: `Cliente ${i}`, rut: `${i + 1}-9`, contacto: null, direccion: 'Calle 1',
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

  it('1200 clientes con cambios se escriben en 3 upserts por id, no en 1200 updates, y no tocan lo que el archivo no trae', async () => {
    const tablas = { clientes: clientesBase(1200) }
    const { sb, llamadas } = crearFalso(tablas)
    const repo = crearRepoConCliente(sb)
    const entrantes = clientesBase(1200).map((f) => ({ nombre: `${f.nombre} (nuevo)`, rut: f.rut as string }))
    expect(await repo.guardarClientes(entrantes)).toEqual({ creados: 0, actualizados: 1200, sinCambios: 0 })
    expect(llamadas.upsert).toBe(3)
    expect(llamadas.update).toBe(0)
    expect(tablas.clientes.every((f) => f.direccion === 'Calle 1' && String(f.nombre).endsWith('(nuevo)'))).toBe(true)
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
    const fila = { id: 'n1', nombre: 'Ferretería', rut: '12345678-5', contacto: null, direccion: 'Calle 1' }
    const { repo, log } = falsoInsert({ data: fila, error: null })
    const c = await repo.crearCliente({ nombre: ' Ferretería ', rut: '12.345.678-5', direccion: 'Calle 1' })
    expect(c).toEqual({ id: 'n1', nombre: 'Ferretería', rut: '12345678-5', direccion: 'Calle 1' })
    expect(log[0]).toEqual(['clientes', { nombre: 'Ferretería', rut: '12345678-5', contacto: null, direccion: 'Calle 1' }])
    expect(log[1]).toBe('id, nombre, rut, contacto, direccion')
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

describe('supabaseRepo: asignaciones cliente-recorrido', () => {
  /** Falso de cliente_recorridos: páginas con range(), upsert por (cliente_id, recorrido_id) y delete con eq/eq/select. */
  function falso(filas: Fila[], error: { code?: string; message: string } | null = null) {
    const llamadas: { upsert: { n: number; onConflict: string }[]; delete: Fila[]; select: number } = { upsert: [], delete: [], select: 0 }
    const sb = {
      from(t: string) {
        expect(t).toBe('cliente_recorridos')
        return {
          select(cols: string) {
            expect(cols).toBe('cliente_id, recorrido_id, fija, orden')
            return {
              order: () => ({
                order: () => ({
                  range(d: number, h: number) {
                    llamadas.select++
                    return Promise.resolve({ data: filas.slice(d, Math.min(h + 1, d + 1000)), error: null })
                  },
                }),
              }),
            }
          },
          upsert(lote: Fila[], o: { onConflict: string }) {
            llamadas.upsert.push({ n: lote.length, onConflict: o.onConflict })
            if (error) return Promise.resolve({ error })
            for (const f of lote) {
              const e = filas.find((x) => x.cliente_id === f.cliente_id && x.recorrido_id === f.recorrido_id)
              if (e) Object.assign(e, f)
              else filas.push({ ...f })
            }
            return Promise.resolve({ error: null })
          },
          delete() {
            const filtro: Fila = {}
            const q = {
              eq(col: string, v: unknown) {
                filtro[col] = v
                return q
              },
              select() {
                llamadas.delete.push(filtro)
                if (error) return Promise.resolve({ data: null, error })
                const i = filas.findIndex((x) => x.cliente_id === filtro.cliente_id && x.recorrido_id === filtro.recorrido_id)
                if (i < 0) return Promise.resolve({ data: [], error: null })
                filas.splice(i, 1)
                return Promise.resolve({ data: [{ cliente_id: filtro.cliente_id }], error: null })
              },
            }
            return q
          },
        }
      },
    }
    return { repo: crearRepoConCliente(sb as unknown as SupabaseClient), llamadas, filas }
  }
  const asig = (i: number, fija = true, orden = i) => ({ clienteId: `c${pad(i)}`, recorridoId: 'r1', fija, orden })
  const filaAsig = (i: number, fija = true, orden = i) => ({ cliente_id: `c${pad(i)}`, recorrido_id: 'r1', fija, orden })

  it('lista todas las asignaciones por páginas (más de 1000)', async () => {
    const { repo, llamadas } = falso(Array.from({ length: 1500 }, (_, i) => filaAsig(i)))
    const lista = await repo.listarAsignaciones()
    expect(lista).toHaveLength(1500)
    expect(lista[1499]).toEqual(asig(1499))
    expect(llamadas.select).toBe(3)
  })

  it('1200 asignaciones nuevas o cambiadas van en lotes de 500 con upsert por (cliente, recorrido); las iguales no se escriben', async () => {
    const existentes = Array.from({ length: 300 }, (_, i) => filaAsig(i))
    const { repo, llamadas, filas } = falso(existentes)
    const entrantes = [
      ...Array.from({ length: 100 }, (_, i) => asig(i)), // sin cambios
      ...Array.from({ length: 200 }, (_, i) => asig(i + 100, false)), // cambia fija
      ...Array.from({ length: 1000 }, (_, i) => asig(i + 300)), // nuevas
    ]
    expect(await repo.guardarAsignaciones(entrantes)).toEqual({ creados: 1000, actualizados: 200, sinCambios: 100 })
    expect(llamadas.upsert).toEqual([
      { n: 500, onConflict: 'cliente_id,recorrido_id' },
      { n: 500, onConflict: 'cliente_id,recorrido_id' },
      { n: 200, onConflict: 'cliente_id,recorrido_id' },
    ])
    expect(filas).toHaveLength(1300)
    expect(filas.find((f) => f.cliente_id === `c${pad(150)}`)).toEqual(filaAsig(150, false))
    // re-guardar lo mismo no escribe nada
    llamadas.upsert.length = 0
    expect(await repo.guardarAsignaciones(entrantes)).toEqual({ creados: 0, actualizados: 0, sinCambios: 1300 })
    expect(llamadas.upsert).toEqual([])
  })

  it('valida antes de llamar a la base y traduce los errores (RLS, recorrido borrado) al español', async () => {
    const { repo, llamadas } = falso([], { code: '42501', message: 'new row violates row-level security policy for table "cliente_recorridos"' })
    await expect(repo.guardarAsignaciones([{ clienteId: 'c', recorridoId: 'r', fija: true, orden: -1 }])).rejects.toThrow(
      'El orden debe ser un número entero de 0 a 100000.',
    )
    expect(llamadas.upsert).toEqual([])
    await expect(repo.guardarAsignaciones([asig(1)])).rejects.toThrow('No tienes permiso para cambiar los recorridos de los clientes.')
    await expect(repo.quitarAsignacion('c1', 'r1')).rejects.toThrow('No tienes permiso para cambiar los recorridos de los clientes.')
    expect(errorDeAsignaciones({ code: '42501', message: 'permission denied for table cliente_recorridos' }).message).toBe(
      'No tienes permiso para cambiar los recorridos de los clientes.',
    )
    expect(errorDeAsignaciones({ code: '23503', message: 'insert or update violates foreign key' }).message).toBe(
      'El cliente o el recorrido ya no existe. Vuelve a cargar la página e inténtalo de nuevo.',
    )
    expect(errorDeAsignaciones({ code: '23514', message: 'violates check constraint "cliente_recorridos_orden_positivo"' }).message).toBe(
      'El orden debe ser un número entero de 0 o más.',
    )
    expect(errorDeAsignaciones({ message: 'TypeError: Failed to fetch' }).message).toBe('No se pudo guardar. Revisa tu conexión e inténtalo de nuevo.')
  })

  it('quitar borra solo ese par; si no borró nada (RLS lo filtró o ya no estaba) avisa en español', async () => {
    const { repo, llamadas, filas } = falso([filaAsig(1), { ...filaAsig(1), recorrido_id: 'r2' }])
    await repo.quitarAsignacion(`c${pad(1)}`, 'r1')
    expect(llamadas.delete).toEqual([{ cliente_id: `c${pad(1)}`, recorrido_id: 'r1' }])
    expect(filas).toEqual([{ ...filaAsig(1), recorrido_id: 'r2' }])
    await expect(repo.quitarAsignacion(`c${pad(1)}`, 'r1')).rejects.toThrow('No se pudo quitar el recorrido (ya no estaba asignado o no tienes permiso).')
  })

  it('filaARecorrido lee el chofer (opcional)', () => {
    expect(filaARecorrido({ id: 'r', nombre: 'Lunes · Angelo', dia: 1, camioneta: 'C2', lejano: false, chofer: 'Angelo' })).toEqual({
      id: 'r', nombre: 'Lunes · Angelo', dia: 1, camioneta: 'C2', lejano: false, chofer: 'Angelo',
    })
    expect(filaARecorrido({ id: 'r', nombre: 'Lunes', dia: 1, camioneta: 'C2', lejano: false, chofer: null })).not.toHaveProperty('chofer')
  })
})
