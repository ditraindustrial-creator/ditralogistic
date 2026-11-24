import { describe, it, expect } from 'vitest'
import { planificarClientes, planificarProductos } from './maestros'
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
