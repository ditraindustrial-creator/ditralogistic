import { describe, it, expect } from 'vitest'
import { parsearCsv, normalizarRut, importarClientes, importarProductos, decodificarArchivo } from './csv'

const BOM = '﻿'

describe('parsearCsv', () => {
  it('lee un CSV de Excel chileno: BOM, separador ;, comillas, comillas escapadas, acentos', () => {
    const texto =
      BOM +
      'Razón Social;RUT;Tamaño\r\n' +
      '"Imprenta ""Sur"", Ltda.";76.123.456-7;Grande\r\n' +
      'Ñandú SpA;12.345.678-5;Pequeño\r\n'
    expect(parsearCsv(texto)).toEqual([
      { 'Razón Social': 'Imprenta "Sur", Ltda.', RUT: '76.123.456-7', Tamaño: 'Grande' },
      { 'Razón Social': 'Ñandú SpA', RUT: '12.345.678-5', Tamaño: 'Pequeño' },
    ])
  })

  it('el separador ; dentro de comillas no parte el campo, y un salto de línea entre comillas se conserva', () => {
    const filas = parsearCsv('a;b\n"x;y";"línea1\nlínea2"\n')
    expect(filas).toEqual([{ a: 'x;y', b: 'línea1\nlínea2' }])
  })

  it('detecta la coma cuando el archivo viene como "CSV (delimitado por comas)"', () => {
    expect(parsearCsv('nombre,rut\n"Pérez, Juan",1-9\n')).toEqual([{ nombre: 'Pérez, Juan', rut: '1-9' }])
  })

  it('el separador se detecta en la primera línea sin contar lo que está entre comillas', () => {
    expect(parsearCsv('"a;b;c",d\n1,2\n')).toEqual([{ 'a;b;c': '1', d: '2' }])
  })

  it('acepta CRLF, CR suelto y quita líneas en blanco al final', () => {
    expect(parsearCsv('a;b\r\n1;2\r\n\r\n\r\n')).toEqual([{ a: '1', b: '2' }])
    expect(parsearCsv('a;b\r1;2\r')).toEqual([{ a: '1', b: '2' }])
  })

  it('filas cortas se completan con vacío y filas largas se recortan', () => {
    expect(parsearCsv('a;b;c\n1;2\n1;2;3;4\n')).toEqual([
      { a: '1', b: '2', c: '' },
      { a: '1', b: '2', c: '3' },
    ])
  })

  it('conserva las líneas en blanco intermedias como filas vacías para que el número de fila coincida con Excel', () => {
    const filas = parsearCsv('a;b\n1;2\n\n3;4\n')
    expect(filas).toHaveLength(3)
    expect(filas[1]).toEqual({ a: '', b: '' })
  })

  it('recorta espacios de los encabezados y de los valores', () => {
    expect(parsearCsv(' a ; b \n 1 ; 2 \n')).toEqual([{ a: '1', b: '2' }])
  })

  it('vacío o solo encabezado da lista vacía', () => {
    expect(parsearCsv('')).toEqual([])
    expect(parsearCsv(BOM)).toEqual([])
    expect(parsearCsv('a;b\n')).toEqual([])
  })

  it('una comilla sin cerrar no pierde el resto del archivo ni se cuelga', () => {
    expect(parsearCsv('a;b\n"x;y\n')).toEqual([{ a: 'x;y\n'.trim(), b: '' }])
  })
})

describe('decodificarArchivo', () => {
  const bytes = (arr: number[]) => new Uint8Array(arr).buffer

  it('decodifica UTF-8 (con BOM) conservando acentos', () => {
    const buf = new TextEncoder().encode(BOM + 'Tamaño;Ñandú').buffer as ArrayBuffer
    expect(decodificarArchivo(buf)).toBe('Tamaño;Ñandú')
  })

  it('cae a windows-1252 cuando los bytes no son UTF-8 (Excel "CSV delimitado por comas")', () => {
    // "Tamaño;Ñandú" en windows-1252: ñ=0xF1, Ñ=0xD1, ú=0xFA
    const buf = bytes([0x54, 0x61, 0x6d, 0x61, 0xf1, 0x6f, 0x3b, 0xd1, 0x61, 0x6e, 0x64, 0xfa])
    expect(decodificarArchivo(buf)).toBe('Tamaño;Ñandú')
  })

  it('windows-1252 decodifica también € y comillas tipográficas (0x80-0x9F)', () => {
    expect(decodificarArchivo(bytes([0x80, 0x93, 0x41, 0x94]))).toBe('€“A”')
  })

  it('reconoce UTF-16 LE con BOM (Excel "Texto Unicode")', () => {
    const buf = bytes([0xff, 0xfe, 0x41, 0x00, 0xf1, 0x00])
    expect(decodificarArchivo(buf)).toBe('Añ')
  })

  it('el resultado de decodificar un archivo latin1 se parsea bien de punta a punta', () => {
    const texto = 'Nombre;RUT\r\nPeña y Cía;12.345.678-5\r\n'
    const latin1 = Uint8Array.from(texto, (c) => c.charCodeAt(0)).buffer
    expect(parsearCsv(decodificarArchivo(latin1))).toEqual([{ Nombre: 'Peña y Cía', RUT: '12.345.678-5' }])
  })
})

describe('normalizarRut', () => {
  it('deja el formato 12345678-5', () => {
    expect(normalizarRut('12.345.678-5')).toBe('12345678-5')
    expect(normalizarRut(' 12345678 5 ')).toBe('12345678-5')
    expect(normalizarRut('12345678-5')).toBe('12345678-5')
    expect(normalizarRut('123456785')).toBe('12345678-5')
  })
  it('dígito verificador K en mayúscula y ceros a la izquierda fuera', () => {
    expect(normalizarRut('7.654.321-k')).toBe('7654321-K')
    expect(normalizarRut('007654321-K')).toBe('7654321-K')
  })
  it('vacío da vacío', () => {
    expect(normalizarRut('  ')).toBe('')
  })
})

describe('importarClientes', () => {
  const mapeo = { nombre: 'Nombre', rut: 'RUT' }

  it('importa las filas buenas y reporta las malas con número de fila y motivo', () => {
    const filas = [
      { Nombre: 'Ñandú SpA', RUT: '12.345.678-5' },
      { Nombre: 'Sin rut', RUT: '' },
      { Nombre: '', RUT: '76.123.456-7' },
      { Nombre: 'RUT raro', RUT: 'abc' },
      { Nombre: 'Última', RUT: '9.999.999-K' },
    ]
    const r = importarClientes(filas, mapeo)
    expect(r.clientes.map((c) => [c.nombre, c.rut])).toEqual([
      ['Ñandú SpA', '12345678-5'],
      ['Última', '9999999-K'],
    ])
    expect(r.errores).toEqual([
      { fila: 3, motivo: 'Falta el RUT.' },
      { fila: 4, motivo: 'Falta el nombre.' },
      { fila: 5, motivo: 'El RUT "abc" no es válido.' },
    ])
  })

  it('dos filas con el mismo RUT (aunque venga con otro formato): reporta el duplicado y conserva la primera', () => {
    const r = importarClientes(
      [
        { Nombre: 'Uno', RUT: '12.345.678-5' },
        { Nombre: 'Dos', RUT: '12345678-5' },
      ],
      mapeo,
    )
    expect(r.clientes).toHaveLength(1)
    expect(r.clientes[0].nombre).toBe('Uno')
    expect(r.errores).toEqual([{ fila: 3, motivo: 'RUT duplicado: ya aparece en la fila 2.' }])
  })

  it('las filas totalmente vacías se ignoran sin error, pero cuentan para el número de fila', () => {
    const r = importarClientes([{ Nombre: '', RUT: '' }, { Nombre: 'X', RUT: '' }], mapeo)
    expect(r.errores).toEqual([{ fila: 3, motivo: 'Falta el RUT.' }])
  })

  it('mapea contacto y dirección si se piden', () => {
    const r = importarClientes([{ N: 'A', R: '1-9', T: 'Ana', D: 'Calle 1' }], { nombre: 'N', rut: 'R', contacto: 'T', direccion: 'D' })
    expect(r.clientes).toEqual([{ nombre: 'A', rut: '1-9', contacto: 'Ana', direccion: 'Calle 1' }])
  })

  it('una columna elegida que no existe en el archivo se informa una sola vez', () => {
    const r = importarClientes([{ Nombre: 'A', RUT: '1-9' }], { nombre: 'Razón', rut: 'RUT' })
    expect(r.clientes).toEqual([])
    expect(r.errores).toEqual([{ fila: 0, motivo: 'La columna "Razón" no existe en el archivo.' }])
  })
})

describe('importarProductos', () => {
  const mapeo = { codigo: 'Código', nombre: 'Descripción', area: 'Área' }

  it('importa productos, entiende el área con o sin acento y reporta lo malo', () => {
    const r = importarProductos(
      [
        { Código: 'A-1', Descripción: 'Cuchillo', Área: 'Afilado' },
        { Código: 'E-1', Descripción: 'Libro', Área: 'encuadernación' },
        { Código: '', Descripción: 'Sin código', Área: 'afilado' },
        { Código: 'X-1', Descripción: 'Raro', Área: 'carpintería' },
        { Código: 'A-1', Descripción: 'Repetido', Área: 'afilado' },
        { Código: 'A-2', Descripción: '', Área: 'afilado' },
      ],
      mapeo,
    )
    expect(r.productos).toEqual([
      { codigo: 'A-1', nombre: 'Cuchillo', area: 'afilado' },
      { codigo: 'E-1', nombre: 'Libro', area: 'encuadernacion' },
    ])
    expect(r.errores).toEqual([
      { fila: 4, motivo: 'Falta el código.' },
      { fila: 5, motivo: 'El área "carpintería" no es válida (usa afilado o encuadernación).' },
      { fila: 6, motivo: 'Código duplicado: ya aparece en la fila 2.' },
      { fila: 7, motivo: 'Falta el nombre.' },
    ])
  })

  it('sin columna de área usa el área por defecto', () => {
    const r = importarProductos([{ c: '1', n: 'Tijera' }], { codigo: 'c', nombre: 'n', areaPorDefecto: 'afilado' })
    expect(r.productos).toEqual([{ codigo: '1', nombre: 'Tijera', area: 'afilado' }])
  })

  it('sin columna ni área por defecto, cada fila reporta que falta el área', () => {
    const r = importarProductos([{ c: '1', n: 'Tijera' }], { codigo: 'c', nombre: 'n' })
    expect(r.errores).toEqual([{ fila: 2, motivo: 'Falta el área.' }])
  })
})
