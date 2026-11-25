import { describe, it, expect } from 'vitest'
import { planificarClientes, planificarProductos, RUT_DUPLICADO, validarClienteNuevo } from './maestros'
import type { Cliente, Producto } from './tipos'

describe('planificarClientes', () => {
  const existentes: Cliente[] = [
    { id: 'c1', nombre: 'Viejo', rut: '12345678-5', contacto: 'Ana', recorridoId: 'r1' },
    { id: 'c2', nombre: 'Formato antiguo', rut: '76.123.456-7', recorridoId: null },
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
    { id: 'c1', nombre: 'Uno', rut: '1-9', contacto: 'Ana', recorridoId: 'r1' },
    { id: 'c2', nombre: 'Dos', rut: '2-7', recorridoId: null },
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
    const p = planificarClientes([{ id: 'c3', nombre: 'X', rut: '76.123.456-7', recorridoId: null }], [{ nombre: 'X', rut: '76123456-7' }])
    expect(p.actualizaciones).toHaveLength(1)
  })
})

describe('planificarProductos', () => {
  it('separa nuevos y actualizaciones por código', () => {
    const existentes: Producto[] = [{ id: 'p1', codigo: 'A-1', nombre: 'Viejo', area: 'afilado' }]
    const p = planificarProductos(existentes, [
      { codigo: 'A-1', nombre: 'Cuchillo', area: 'afilado' },
      { codigo: 'B-2', nombre: 'Libro', area: 'encuadernacion' },
    ])
    expect(p.nuevos).toEqual([{ codigo: 'B-2', nombre: 'Libro', area: 'encuadernacion' }])
    expect(p.actualizaciones).toEqual([{ id: 'p1', cambios: { codigo: 'A-1', nombre: 'Cuchillo', area: 'afilado' } }])
  })
})

describe('validarClienteNuevo', () => {
  const existentes: Cliente[] = [{ id: 'c1', nombre: 'Imprenta Sur', rut: '76.123.456-7', recorridoId: null }]

  it('normaliza el RUT y los textos, y omite los opcionales vacíos', () => {
    const r = validarClienteNuevo({ nombre: '  Ferretería Norte ', rut: '12.345.678-5', contacto: ' ', direccion: ' Calle 1 ', recorridoId: '' })
    expect(r.errores).toEqual([])
    expect(r.cliente).toEqual({ nombre: 'Ferretería Norte', rut: '12345678-5', direccion: 'Calle 1', recorridoId: null })
  })
  it('acepta un recorrido y la K del dígito verificador en minúscula', () => {
    const r = validarClienteNuevo({ nombre: 'Uno', rut: '9.999.999-k', recorridoId: 'r1' })
    expect(r.errores).toEqual([])
    expect(r.cliente).toEqual({ nombre: 'Uno', rut: '9999999-K', recorridoId: 'r1' })
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
