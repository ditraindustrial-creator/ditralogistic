import { describe, it, expect } from 'vitest'
import { validarTrabajoNuevo, primeraEtapa, filtrarClientes, parsearCantidad, type DatosTrabajoNuevo } from './trabajo'
import type { Cliente, Etapa } from './tipos'

const base: DatosTrabajoNuevo = {
  clienteId: 'c1',
  area: 'afilado',
  entrada: 'cliente',
  lineas: [{ producto: 'Cuchillo', cantidad: 12 }],
}

describe('validarTrabajoNuevo', () => {
  it('una línea de 12 unidades con cliente es válida', () => {
    expect(validarTrabajoNuevo(base)).toEqual([])
  })
  it('sin cliente', () => {
    expect(validarTrabajoNuevo({ ...base, clienteId: '' })).toEqual(['Elige el cliente.'])
  })
  it('sin líneas', () => {
    expect(validarTrabajoNuevo({ ...base, lineas: [] })).toEqual(['Agrega al menos una línea.'])
  })
  it('cantidad 0, negativa, decimal o NaN, con el número de línea', () => {
    for (const cantidad of [0, -2, 1.5, NaN]) {
      expect(validarTrabajoNuevo({ ...base, lineas: [{ producto: 'A', cantidad: 1 }, { producto: 'B', cantidad }] })).toEqual([
        'La cantidad de la línea 2 debe ser un número entero mayor que cero.',
      ])
    }
  })
  it('producto vacío o solo espacios', () => {
    expect(validarTrabajoNuevo({ ...base, lineas: [{ producto: '  ', cantidad: 1 }] })).toEqual(['La línea 1 necesita un producto.'])
  })
  it('acumula todos los errores', () => {
    expect(validarTrabajoNuevo({ ...base, clienteId: '', lineas: [{ producto: '', cantidad: 0 }] })).toEqual([
      'Elige el cliente.',
      'La línea 1 necesita un producto.',
      'La cantidad de la línea 1 debe ser un número entero mayor que cero.',
    ])
  })
  it('área y modalidades desconocidas', () => {
    expect(validarTrabajoNuevo({ ...base, area: 'x' as never })).toEqual(['Elige el área (afilado o encuadernación).'])
    expect(validarTrabajoNuevo({ ...base, entrada: 'x' as never })).toEqual(['Elige cómo llegó el trabajo.'])
    expect(validarTrabajoNuevo({ ...base, salida: 'x' as never })).toEqual(['La modalidad de salida no es válida.'])
  })
})

describe('primeraEtapa', () => {
  const e = (id: string, area: Etapa['area'], orden: number): Etapa => ({ id, area, orden, nombre: id, esListo: false, esFinal: false })
  it('es la de menor orden del área, aunque vengan desordenadas', () => {
    const etapas = [e('b2', 'encuadernacion', 2), e('a3', 'afilado', 3), e('a1', 'afilado', 1), e('a2', 'afilado', 2), e('b1', 'encuadernacion', 1)]
    expect(primeraEtapa(etapas, 'afilado')?.id).toBe('a1')
    expect(primeraEtapa(etapas, 'encuadernacion')?.id).toBe('b1')
  })
  it('sin etapas del área devuelve undefined', () => {
    expect(primeraEtapa([e('a1', 'afilado', 1)], 'encuadernacion')).toBeUndefined()
  })
})

describe('parsearCantidad', () => {
  it('solo acepta enteros positivos en texto', () => {
    expect(parsearCantidad('12')).toBe(12)
    expect(parsearCantidad(' 7 ')).toBe(7)
    for (const t of ['', 'abc', '1.5', '1,5', '-3', '1e2', '0x10']) expect(parsearCantidad(t)).toBeNaN()
  })
})

describe('filtrarClientes', () => {
  const c = (id: string, nombre: string, rut: string): Cliente => ({ id, nombre, rut })
  const lista = [
    c('1', 'Imprenta Sur Ltda.', '76123456-7'),
    c('2', 'Ñandú SpA', '12345678-5'),
    c('3', 'Librería Austral', '99888777-K'),
    c('4', 'Surtidora Peña', '11111111-1'),
  ]
  it('busca por nombre sin importar mayúsculas ni acentos', () => {
    expect(filtrarClientes(lista, 'LIBRERIA').map((x) => x.id)).toEqual(['3'])
    expect(filtrarClientes(lista, 'nandu').map((x) => x.id)).toEqual(['2'])
  })
  it('busca por RUT con o sin puntos y guion', () => {
    expect(filtrarClientes(lista, '76.123.456-7').map((x) => x.id)).toEqual(['1'])
    expect(filtrarClientes(lista, '761234').map((x) => x.id)).toEqual(['1'])
    expect(filtrarClientes(lista, '99888777k').map((x) => x.id)).toEqual(['3'])
  })
  it('los que empiezan con el texto van primero y se respeta el límite', () => {
    expect(filtrarClientes(lista, 'sur').map((x) => x.id)).toEqual(['4', '1'])
    expect(filtrarClientes(lista, 'sur', 1).map((x) => x.id)).toEqual(['4'])
  })
  it('texto vacío no sugiere nada', () => {
    expect(filtrarClientes(lista, '  ')).toEqual([])
  })
  it('varias palabras deben aparecer todas', () => {
    expect(filtrarClientes(lista, 'imprenta ltda').map((x) => x.id)).toEqual(['1'])
    expect(filtrarClientes(lista, 'imprenta peña')).toEqual([])
  })
})
