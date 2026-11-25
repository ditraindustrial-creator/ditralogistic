import { describe, it, expect } from 'vitest'
import { nombreRecorrido, planificarAsignaciones, siguienteOrden, planificarClientes, planificarProductos, RUT_DUPLICADO, validarAsignacion, validarClienteNuevo } from './maestros'
import type { Asignacion, Cliente, Producto } from './tipos'

describe('planificarClientes', () => {
  const existentes: Cliente[] = [
    { id: 'c1', nombre: 'Viejo', rut: '12345678-5', contacto: 'Ana' },
    { id: 'c2', nombre: 'Formato antiguo', rut: '76.123.456-7' },
  ]

  it('separa nuevos y actualizaciones por RUT normalizado, sin tocar el recorrido', () => {
    const p = planificarClientes(existentes, [
      { nombre: 'Nuevo nombre', rut: '12345678-5' },
      { nombre: 'Otro', rut: '76123456-7', direccion: 'Calle 1' },
      { nombre: 'Recién llegado', rut: '9999999-K' },
    ])
    expect(p.nuevos).toEqual([{ nombre: 'Recién llegado', rut: '9999999-K' }])
    expect(p.actualizaciones).toEqual([
      { id: 'c1', cambios: { nombre: 'Nuevo nombre', rut: '12345678-5' } },
      { id: 'c2', cambios: { nombre: 'Otro', rut: '76123456-7', direccion: 'Calle 1' } },
    ])
  })
})

describe('planificarClientes: sin cambios', () => {
  const existentes: Cliente[] = [
    { id: 'c1', nombre: 'Uno', rut: '1-9', contacto: 'Ana' },
    { id: 'c2', nombre: 'Dos', rut: '2-7' },
  ]
  it('omite las filas idénticas y devuelve solo las que cambian, contándolas', () => {
    const p = planificarClientes(existentes, [
      { nombre: 'Uno', rut: '1-9' },
      { nombre: 'Uno', rut: '1-9', contacto: 'Ana' },
      { nombre: 'Dos cambiado', rut: '2-7' },
    ])
    expect(p.sinCambios).toBe(2)
    expect(p.nuevos).toEqual([])
    expect(p.actualizaciones).toEqual([{ id: 'c2', cambios: { nombre: 'Dos cambiado', rut: '2-7' } }])
  })
  it('un campo informado que difiere (contacto) cuenta como cambio y no arrastra el recorrido', () => {
    const p = planificarClientes(existentes, [{ nombre: 'Uno', rut: '1-9', contacto: 'Beto' }])
    expect(p.actualizaciones).toEqual([{ id: 'c1', cambios: { nombre: 'Uno', rut: '1-9', contacto: 'Beto' } }])
    expect(p.actualizaciones[0].cambios).not.toHaveProperty('recorridoId')
  })
  it('un RUT guardado con otro formato se normaliza: se actualiza', () => {
    const p = planificarClientes([{ id: 'c3', nombre: 'X', rut: '76.123.456-7' }], [{ nombre: 'X', rut: '76123456-7' }])
    expect(p.actualizaciones).toHaveLength(1)
  })
})

describe('planificarProductos', () => {
  it('separa nuevos y actualizaciones por código', () => {
    const existentes: Producto[] = [{ id: 'p1', codigo: 'A-1', nombre: 'Viejo', area: 'afilado', tipo: 'herramienta' }]
    const p = planificarProductos(existentes, [
      { codigo: 'A-1', nombre: 'Cuchillo', area: 'afilado', tipo: 'herramienta' },
      { codigo: 'B-2', nombre: 'Libro', area: 'encuadernacion', tipo: 'herramienta' },
    ])
    expect(p.nuevos).toEqual([{ codigo: 'B-2', nombre: 'Libro', area: 'encuadernacion', tipo: 'herramienta' }])
    expect(p.actualizaciones).toEqual([{ id: 'p1', cambios: { codigo: 'A-1', nombre: 'Cuchillo', area: 'afilado', tipo: 'herramienta' } }])
  })
})

describe('validarClienteNuevo', () => {
  const existentes: Cliente[] = [{ id: 'c1', nombre: 'Imprenta Sur', rut: '76.123.456-7' }]

  it('normaliza el RUT y los textos, y omite los opcionales vacíos', () => {
    const r = validarClienteNuevo({ nombre: '  Ferretería Norte ', rut: '12.345.678-5', contacto: ' ', direccion: ' Calle 1 ' })
    expect(r.errores).toEqual([])
    expect(r.cliente).toEqual({ nombre: 'Ferretería Norte', rut: '12345678-5', direccion: 'Calle 1' })
  })
  it('acepta un recorrido y la K del dígito verificador en minúscula', () => {
    const r = validarClienteNuevo({ nombre: 'Uno', rut: '9.999.999-k' })
    expect(r.errores).toEqual([])
    expect(r.cliente).toEqual({ nombre: 'Uno', rut: '9999999-K' })
  })
  it('exige nombre y RUT', () => {
    expect(validarClienteNuevo({ nombre: ' ', rut: '' }).errores).toEqual(['Escribe el nombre del cliente.', 'Escribe el RUT.'])
  })
  it('rechaza un RUT mal escrito con las mismas reglas del importador', () => {
    expect(validarClienteNuevo({ nombre: 'X', rut: 'abc' }).errores).toEqual([
      'El RUT "abc" no es válido. Escríbelo así: 12.345.678-5.',
    ])
    expect(validarClienteNuevo({ nombre: 'X', rut: '1234567890-1' }).errores).toHaveLength(1)
  })
  it('avisa del RUT repetido aunque venga en otro formato', () => {
    expect(validarClienteNuevo({ nombre: 'Otra', rut: '76123456-7' }, existentes).errores).toEqual([RUT_DUPLICADO])
  })
  it('limita el largo de los textos', () => {
    const largo = 'x'.repeat(201)
    expect(validarClienteNuevo({ nombre: largo, rut: '1-9', contacto: largo, direccion: largo }).errores).toEqual([
      'El nombre puede tener hasta 200 caracteres.',
      'El contacto puede tener hasta 200 caracteres.',
      'La dirección puede tener hasta 200 caracteres.',
    ])
  })
})

describe('planificarAsignaciones', () => {
  const existentes: Asignacion[] = [
    { clienteId: 'c1', recorridoId: 'r1', fija: true, orden: 1 },
    { clienteId: 'c1', recorridoId: 'r2', fija: false, orden: 0 },
  ]
  it('idempotente por (cliente, recorrido): nuevas, actualizadas (fija u orden distintos) y sin cambios', () => {
    const p = planificarAsignaciones(existentes, [
      { clienteId: 'c1', recorridoId: 'r1', fija: true, orden: 1 },
      { clienteId: 'c1', recorridoId: 'r2', fija: true, orden: 0 },
      { clienteId: 'c2', recorridoId: 'r1', fija: false, orden: 4 },
    ])
    expect(p.sinCambios).toBe(1)
    expect(p.nuevas).toEqual([{ clienteId: 'c2', recorridoId: 'r1', fija: false, orden: 4 }])
    expect(p.actualizaciones).toEqual([{ clienteId: 'c1', recorridoId: 'r2', fija: true, orden: 0 }])
    // re-importar lo mismo no cambia nada
    const otra = planificarAsignaciones([...existentes.slice(0, 1), ...p.actualizaciones, ...p.nuevas], [
      { clienteId: 'c1', recorridoId: 'r2', fija: true, orden: 0 },
      { clienteId: 'c2', recorridoId: 'r1', fija: false, orden: 4 },
    ])
    expect(otra).toEqual({ nuevas: [], actualizaciones: [], sinCambios: 2 })
  })
  it('un par repetido en la entrada se escribe una vez y manda el último', () => {
    const p = planificarAsignaciones([], [
      { clienteId: 'c9', recorridoId: 'r1', fija: true, orden: 1 },
      { clienteId: 'c9', recorridoId: 'r1', fija: false, orden: 2 },
    ])
    expect(p).toEqual({ nuevas: [{ clienteId: 'c9', recorridoId: 'r1', fija: false, orden: 2 }], actualizaciones: [], sinCambios: 0 })
  })
})

describe('validarAsignacion', () => {
  it('acepta un orden entero de 0 o más', () => {
    expect(validarAsignacion({ clienteId: 'c', recorridoId: 'r', fija: true, orden: 0 })).toBeNull()
    expect(validarAsignacion({ clienteId: 'c', recorridoId: 'r', fija: false, orden: 12 })).toBeNull()
  })
  it('rechaza orden negativo, decimal o enorme, y cliente o recorrido vacíos', () => {
    expect(validarAsignacion({ clienteId: 'c', recorridoId: 'r', fija: true, orden: -1 })).toBe('El orden debe ser un número entero de 0 a 100000.')
    expect(validarAsignacion({ clienteId: 'c', recorridoId: 'r', fija: true, orden: 1.5 })).toBe('El orden debe ser un número entero de 0 a 100000.')
    expect(validarAsignacion({ clienteId: 'c', recorridoId: 'r', fija: true, orden: 100001 })).toBe('El orden debe ser un número entero de 0 a 100000.')
    expect(validarAsignacion({ clienteId: '', recorridoId: 'r', fija: true, orden: 0 })).toBe('Elige el cliente.')
    expect(validarAsignacion({ clienteId: 'c', recorridoId: '', fija: true, orden: 0 })).toBe('Elige el recorrido.')
  })
})

describe('nombreRecorrido', () => {
  it('usa el nombre escrito; si está vacío y hay chofer, "Día · Chofer"', () => {
    expect(nombreRecorrido('  Costa ', 2, 'Angelo')).toBe('Costa')
    expect(nombreRecorrido('', 3, ' Rodrigo Lagos ')).toBe('Miércoles · Rodrigo Lagos')
    expect(nombreRecorrido('  ', 1, '')).toBe('')
    expect(nombreRecorrido('', 5)).toBe('')
  })
})

describe('siguienteOrden', () => {
  it('el siguiente al mayor orden del recorrido (1 si está vacío)', () => {
    const a: Asignacion[] = [
      { clienteId: 'c1', recorridoId: 'r1', fija: true, orden: 4 },
      { clienteId: 'c2', recorridoId: 'r1', fija: false, orden: 2 },
      { clienteId: 'c3', recorridoId: 'r2', fija: true, orden: 9 },
    ]
    expect(siguienteOrden(a, 'r1')).toBe(5)
    expect(siguienteOrden(a, 'r3')).toBe(1)
  })
})
