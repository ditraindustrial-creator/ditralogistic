import { describe, it, expect } from 'vitest'
import { crearMemoryRepo } from './memoryRepo'

describe('memoryRepo: maestros', () => {
  it('importar clientes dos veces actualiza y no duplica; conserva el recorrido asignado', async () => {
    const r = crearMemoryRepo()
    const rec = await r.guardarRecorrido({ nombre: 'Lunes centro', dia: 1, camioneta: 'A', lejano: false })
    expect(await r.guardarClientes([{ nombre: 'Uno', rut: '1-9' }])).toEqual({ creados: 1, actualizados: 0, sinCambios: 0 })
    const [c] = await r.listarClientes()
    await r.asignarRecorrido(c.id, rec.id)
    expect(await r.guardarClientes([{ nombre: 'Uno renombrado', rut: '1-9', direccion: 'Calle 1' }, { nombre: 'Dos', rut: '2-7' }])).toEqual({
      creados: 1,
      actualizados: 1,
      sinCambios: 0,
    })
    const lista = await r.listarClientes()
    expect(lista).toHaveLength(2)
    expect(lista.find((x) => x.rut === '1-9')).toMatchObject({ id: c.id, nombre: 'Uno renombrado', direccion: 'Calle 1', recorridoId: rec.id })
    expect(lista.find((x) => x.rut === '2-7')?.recorridoId).toBeNull()
  })

  it('re-importar lo mismo no cambia nada y conserva el recorrido', async () => {
    const r = crearMemoryRepo()
    const rec = await r.guardarRecorrido({ nombre: 'Lunes', dia: 1, camioneta: 'A', lejano: false })
    await r.guardarClientes([{ nombre: 'Uno', rut: '1-9' }])
    const [c] = await r.listarClientes()
    await r.asignarRecorrido(c.id, rec.id)
    expect(await r.guardarClientes([{ nombre: 'Uno', rut: '1-9' }])).toEqual({ creados: 0, actualizados: 0, sinCambios: 1 })
    expect((await r.listarClientes())[0].recorridoId).toBe(rec.id)
  })

  it('guardarRecorrido crea y, con id, edita; asignarRecorrido(null) lo quita', async () => {
    const r = crearMemoryRepo()
    const a = await r.guardarRecorrido({ nombre: 'Martes', dia: 2, camioneta: 'A', lejano: false })
    const editado = await r.guardarRecorrido({ ...a, lejano: true })
    expect(editado).toEqual({ ...a, lejano: true })
    expect(await r.listarRecorridos()).toEqual([editado])
    await r.guardarClientes([{ nombre: 'Uno', rut: '1-9' }])
    const [c] = await r.listarClientes()
    await r.asignarRecorrido(c.id, a.id)
    await r.asignarRecorrido(c.id, null)
    expect((await r.listarClientes())[0].recorridoId).toBeNull()
  })

  it('asignarRecorrido rechaza cliente o recorrido inexistente', async () => {
    const r = crearMemoryRepo()
    await expect(r.asignarRecorrido('nada', null)).rejects.toThrow('El cliente no existe.')
    await r.guardarClientes([{ nombre: 'Uno', rut: '1-9' }])
    const [c] = await r.listarClientes()
    await expect(r.asignarRecorrido(c.id, 'nada')).rejects.toThrow('El recorrido no existe.')
  })

  it('productos: importar dos veces actualiza por código', async () => {
    const r = crearMemoryRepo()
    expect(await r.guardarProductos([{ codigo: 'A-1', nombre: 'Cuchillo', area: 'afilado' }])).toEqual({ creados: 1, actualizados: 0, sinCambios: 0 })
    expect(await r.guardarProductos([{ codigo: 'A-1', nombre: 'Cuchillo chef', area: 'afilado' }])).toEqual({ creados: 0, actualizados: 1, sinCambios: 0 })
    expect(await r.listarProductos()).toMatchObject([{ codigo: 'A-1', nombre: 'Cuchillo chef' }])
  })

  it('con sesión, solo admin y gestión pueden guardar', async () => {
    const r = crearMemoryRepo({ usuario: { id: 'u', nombre: 'Op', rol: 'operario_afilado' } })
    await expect(r.guardarClientes([{ nombre: 'Uno', rut: '1-9' }])).rejects.toThrow('No tienes permiso para modificar los maestros.')
    await expect(r.guardarProductos([])).rejects.toThrow('No tienes permiso para modificar los maestros.')
    await expect(r.guardarRecorrido({ nombre: 'x', dia: 1, camioneta: 'A', lejano: false })).rejects.toThrow('No tienes permiso')
  })
})

describe('memoryRepo.crearCliente', () => {
  const base = { recorridos: [{ id: 'r1', nombre: 'Norte', dia: 2 as const, camioneta: 'A', lejano: false }], clientes: [{ id: 'c1', nombre: 'Uno', rut: '1-9', recorridoId: null }] }
  it('gestión y chofer crean un cliente con el RUT normalizado y el recorrido elegido', async () => {
    for (const rol of ['secretaria', 'jefe_taller', 'admin', 'chofer'] as const) {
      const r = crearMemoryRepo({ ...base, usuario: { id: 'u', nombre: 'U', rol } })
      const c = await r.crearCliente({ nombre: ' Ferretería ', rut: '12.345.678-5', recorridoId: 'r1' })
      expect(c).toMatchObject({ nombre: 'Ferretería', rut: '12345678-5', recorridoId: 'r1' })
      expect((await r.listarClientes()).map((x) => x.rut)).toEqual(['1-9', '12345678-5'])
    }
  })
  it('RUT repetido, datos inválidos, recorrido inexistente y roles sin permiso dan un mensaje en español', async () => {
    const r = crearMemoryRepo({ ...base, usuario: { id: 'u', nombre: 'U', rol: 'secretaria' } })
    await expect(r.crearCliente({ nombre: 'Otro', rut: '1-9' })).rejects.toThrow(
      'Ya existe un cliente con ese RUT. Búscalo por nombre o RUT en vez de crearlo de nuevo.',
    )
    await expect(r.crearCliente({ nombre: '', rut: '2-7' })).rejects.toThrow('Escribe el nombre del cliente.')
    await expect(r.crearCliente({ nombre: 'X', rut: '2-7', recorridoId: 'zz' })).rejects.toThrow('El recorrido no existe.')
    const op = crearMemoryRepo({ ...base, usuario: { id: 'o', nombre: 'O', rol: 'operario_afilado' } })
    await expect(op.crearCliente({ nombre: 'X', rut: '2-7' })).rejects.toThrow('No tienes permiso para crear clientes.')
    await expect(crearMemoryRepo(base).crearCliente({ nombre: 'X', rut: '2-7' })).rejects.toThrow('Debes iniciar sesión para crear clientes.')
    expect(await r.listarClientes()).toHaveLength(1)
  })
})
