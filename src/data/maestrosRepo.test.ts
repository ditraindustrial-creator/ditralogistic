import { describe, it, expect } from 'vitest'
import { crearMemoryRepo } from './memoryRepo'

describe('memoryRepo: maestros', () => {
  it('importar clientes dos veces actualiza y no duplica; conserva sus recorridos asignados', async () => {
    const r = crearMemoryRepo()
    const rec = await r.guardarRecorrido({ nombre: 'Lunes centro', dia: 1, camioneta: 'A', lejano: false })
    expect(await r.guardarClientes([{ nombre: 'Uno', rut: '1-9' }])).toEqual({ creados: 1, actualizados: 0, sinCambios: 0 })
    const [c] = await r.listarClientes()
    await r.guardarAsignaciones([{ clienteId: c.id, recorridoId: rec.id, fija: true, orden: 1 }])
    expect(await r.guardarClientes([{ nombre: 'Uno renombrado', rut: '1-9', direccion: 'Calle 1' }, { nombre: 'Dos', rut: '2-7' }])).toEqual({
      creados: 1,
      actualizados: 1,
      sinCambios: 0,
    })
    const lista = await r.listarClientes()
    expect(lista).toHaveLength(2)
    expect(lista.find((x) => x.rut === '1-9')).toEqual({ id: c.id, nombre: 'Uno renombrado', rut: '1-9', direccion: 'Calle 1' })
    expect(await r.listarAsignaciones()).toEqual([{ clienteId: c.id, recorridoId: rec.id, fija: true, orden: 1 }])
  })

  it('guardarRecorrido crea y, con id, edita (también el chofer titular)', async () => {
    const r = crearMemoryRepo()
    const a = await r.guardarRecorrido({ nombre: 'Martes · Angelo', dia: 2, camioneta: 'A', lejano: false, chofer: 'Angelo' })
    expect(a).toMatchObject({ nombre: 'Martes · Angelo', chofer: 'Angelo' })
    const editado = await r.guardarRecorrido({ ...a, lejano: true, chofer: 'Rodrigo Lagos' })
    expect(editado).toEqual({ ...a, lejano: true, chofer: 'Rodrigo Lagos' })
    expect(await r.listarRecorridos()).toEqual([editado])
    const sinChofer = await r.guardarRecorrido({ ...editado, chofer: undefined })
    expect(sinChofer).not.toHaveProperty('chofer')
  })

  it('asignaciones: un cliente en varios recorridos; guardar es idempotente por (cliente, recorrido); quitar borra una sola', async () => {
    const r = crearMemoryRepo()
    const lun = await r.guardarRecorrido({ nombre: 'Lunes', dia: 1, camioneta: 'A', lejano: false })
    const mie = await r.guardarRecorrido({ nombre: 'Miércoles', dia: 3, camioneta: 'A', lejano: false })
    await r.guardarClientes([{ nombre: 'Uno', rut: '1-9' }])
    const [c] = await r.listarClientes()
    expect(await r.guardarAsignaciones([
      { clienteId: c.id, recorridoId: lun.id, fija: true, orden: 1 },
      { clienteId: c.id, recorridoId: mie.id, fija: false, orden: 2 },
    ])).toEqual({ creados: 2, actualizados: 0, sinCambios: 0 })
    expect(await r.guardarAsignaciones([
      { clienteId: c.id, recorridoId: lun.id, fija: true, orden: 1 },
      { clienteId: c.id, recorridoId: mie.id, fija: true, orden: 2 },
    ])).toEqual({ creados: 0, actualizados: 1, sinCambios: 1 })
    expect((await r.cargarTodo()).asignaciones).toEqual([
      { clienteId: c.id, recorridoId: lun.id, fija: true, orden: 1 },
      { clienteId: c.id, recorridoId: mie.id, fija: true, orden: 2 },
    ])
    await r.quitarAsignacion(c.id, lun.id)
    expect(await r.listarAsignaciones()).toEqual([{ clienteId: c.id, recorridoId: mie.id, fija: true, orden: 2 }])
    await expect(r.quitarAsignacion(c.id, lun.id)).rejects.toThrow('No se pudo quitar el recorrido (ya no estaba asignado o no tienes permiso).')
  })

  it('guardarAsignaciones valida todo antes de escribir: cliente o recorrido inexistente y orden inválido, en español', async () => {
    const r = crearMemoryRepo({ recorridos: [{ id: 'r1', nombre: 'Lunes', dia: 1, camioneta: 'A', lejano: false }], clientes: [{ id: 'c1', nombre: 'Uno', rut: '1-9' }] })
    await expect(r.guardarAsignaciones([{ clienteId: 'nada', recorridoId: 'r1', fija: true, orden: 0 }])).rejects.toThrow('El cliente no existe.')
    await expect(r.guardarAsignaciones([{ clienteId: 'c1', recorridoId: 'nada', fija: true, orden: 0 }])).rejects.toThrow('El recorrido no existe.')
    await expect(r.guardarAsignaciones([
      { clienteId: 'c1', recorridoId: 'r1', fija: true, orden: 0 },
      { clienteId: 'c1', recorridoId: 'r1', fija: true, orden: -2 },
    ])).rejects.toThrow('El orden debe ser un número entero de 0 a 100000.')
    expect(await r.listarAsignaciones()).toEqual([])
  })

  it('asignaciones: solo gestión (admin, secretaria, jefe de taller) escribe; chofer y operarios solo leen', async () => {
    const base = {
      recorridos: [{ id: 'r1', nombre: 'Lunes', dia: 1 as const, camioneta: 'A', lejano: false }],
      clientes: [{ id: 'c1', nombre: 'Uno', rut: '1-9' }],
      asignaciones: [{ clienteId: 'c1', recorridoId: 'r1', fija: true, orden: 0 }],
    }
    for (const rol of ['admin', 'secretaria', 'jefe_taller'] as const) {
      const r = crearMemoryRepo({ ...base, usuario: { id: 'u', nombre: 'U', rol } })
      expect(await r.guardarAsignaciones([{ clienteId: 'c1', recorridoId: 'r1', fija: false, orden: 3 }])).toEqual({ creados: 0, actualizados: 1, sinCambios: 0 })
      await r.quitarAsignacion('c1', 'r1')
    }
    for (const rol of ['chofer', 'operario_afilado', 'operario_encuadernacion'] as const) {
      const r = crearMemoryRepo({ ...base, usuario: { id: 'u', nombre: 'U', rol } })
      expect(await r.listarAsignaciones()).toEqual(base.asignaciones)
      await expect(r.guardarAsignaciones([{ clienteId: 'c1', recorridoId: 'r1', fija: false, orden: 3 }])).rejects.toThrow(
        'No tienes permiso para cambiar los recorridos de los clientes.',
      )
      await expect(r.quitarAsignacion('c1', 'r1')).rejects.toThrow('No tienes permiso para cambiar los recorridos de los clientes.')
      expect(await r.listarAsignaciones()).toEqual(base.asignaciones)
    }
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
  const base = { recorridos: [{ id: 'r1', nombre: 'Norte', dia: 2 as const, camioneta: 'A', lejano: false }], clientes: [{ id: 'c1', nombre: 'Uno', rut: '1-9' }] }
  it('gestión y chofer crean un cliente con el RUT normalizado (sin recorrido: se asigna en Administración)', async () => {
    for (const rol of ['secretaria', 'jefe_taller', 'admin', 'chofer'] as const) {
      const r = crearMemoryRepo({ ...base, usuario: { id: 'u', nombre: 'U', rol } })
      const c = await r.crearCliente({ nombre: ' Ferretería ', rut: '12.345.678-5' })
      expect(c).toMatchObject({ nombre: 'Ferretería', rut: '12345678-5' })
      expect((await r.listarClientes()).map((x) => x.rut)).toEqual(['1-9', '12345678-5'])
    }
  })
  it('RUT repetido, datos inválidos y roles sin permiso dan un mensaje en español', async () => {
    const r = crearMemoryRepo({ ...base, usuario: { id: 'u', nombre: 'U', rol: 'secretaria' } })
    await expect(r.crearCliente({ nombre: 'Otro', rut: '1-9' })).rejects.toThrow(
      'Ya existe un cliente con ese RUT. Búscalo por nombre o RUT en vez de crearlo de nuevo.',
    )
    await expect(r.crearCliente({ nombre: '', rut: '2-7' })).rejects.toThrow('Escribe el nombre del cliente.')
    const op = crearMemoryRepo({ ...base, usuario: { id: 'o', nombre: 'O', rol: 'operario_afilado' } })
    await expect(op.crearCliente({ nombre: 'X', rut: '2-7' })).rejects.toThrow('No tienes permiso para crear clientes.')
    await expect(crearMemoryRepo(base).crearCliente({ nombre: 'X', rut: '2-7' })).rejects.toThrow('Debes iniciar sesión para crear clientes.')
    expect(await r.listarClientes()).toHaveLength(1)
  })
})
