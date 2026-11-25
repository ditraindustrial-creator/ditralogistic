import { describe, it, expect } from 'vitest'
import { parsearCsv, normalizarRut, importarClientes, importarProductos, importarAsignaciones, decodificarArchivo } from './csv'
import type { Cliente, Recorrido } from './tipos'
import plantilla from '../../docs/plantilla-asignaciones.csv?raw'

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
      { codigo: 'A-1', nombre: 'Cuchillo', area: 'afilado', tipo: 'herramienta' },
      { codigo: 'E-1', nombre: 'Libro', area: 'encuadernacion', tipo: 'herramienta' },
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
    expect(r.productos).toEqual([{ codigo: '1', nombre: 'Tijera', area: 'afilado', tipo: 'herramienta' }])
  })

  it('lee el tipo (herramienta o servicio) de su columna; vacío usa el tipo por defecto; lo inválido se reporta', () => {
    const r = importarProductos(
      [
        { c: '1', n: 'Cuchillo recto', t: 'Herramienta' },
        { c: '2', n: 'Afilado de disco', t: 'SERVICIO' },
        { c: '3', n: 'Sin tipo', t: '' },
        { c: '4', n: 'Raro', t: 'repuesto' },
      ],
      { codigo: 'c', nombre: 'n', tipo: 't', areaPorDefecto: 'afilado', tipoPorDefecto: 'servicio' },
    )
    expect(r.productos.map((p) => [p.codigo, p.tipo])).toEqual([['1', 'herramienta'], ['2', 'servicio'], ['3', 'servicio']])
    expect(r.errores).toEqual([{ fila: 5, motivo: 'El tipo "repuesto" no es válido (usa herramienta o servicio).' }])
  })

  it('sin columna ni área por defecto, cada fila reporta que falta el área', () => {
    const r = importarProductos([{ c: '1', n: 'Tijera' }], { codigo: 'c', nombre: 'n' })
    expect(r.errores).toEqual([{ fila: 2, motivo: 'Falta el área.' }])
  })
})

describe('importarAsignaciones', () => {
  const recorridos: Recorrido[] = [
    { id: 'lunR', nombre: 'Lunes · Rodrigo Lagos', dia: 1, camioneta: 'C1', lejano: false, chofer: 'Rodrigo Lagos' },
    { id: 'mieA', nombre: 'Miércoles · Angelo', dia: 3, camioneta: 'C2', lejano: false },
    { id: 'vieA', nombre: 'Viernes  Angelo', dia: 5, camioneta: 'C2', lejano: false },
  ]
  const clientes: Cliente[] = [
    { id: 'c1', nombre: 'Uno', rut: '11.111.111-1' },
    { id: 'c2', nombre: 'Dos', rut: '22222222-2' },
    { id: 'c3', nombre: 'Tres', rut: '7654321-K' },
  ]
  const mapeo = { recorrido: 'recorrido', rut: 'rut', fija: 'fija', orden: 'orden' }
  const importar = (filas: Record<string, string>[], m: Parameters<typeof importarAsignaciones>[1] = mapeo) =>
    importarAsignaciones(filas, m, recorridos, clientes)

  it('reconoce el recorrido sin importar mayúsculas, tildes ni espacios, y el cliente por RUT con o sin puntos', () => {
    const r = importar([
      { recorrido: 'LUNES · RODRIGO LAGOS', rut: '11111111-1', fija: 'sí', orden: '2' },
      { recorrido: 'miercoles · angelo', rut: '22.222.222-2', fija: 'no', orden: '0' },
      { recorrido: ' viernes angelo ', rut: '7.654.321-k', fija: '', orden: '5' },
    ])
    expect(r.errores).toEqual([])
    expect(r.asignaciones).toEqual([
      { clienteId: 'c1', recorridoId: 'lunR', fija: true, orden: 2 },
      { clienteId: 'c2', recorridoId: 'mieA', fija: false, orden: 0 },
      { clienteId: 'c3', recorridoId: 'vieA', fija: true, orden: 5 },
    ])
  })

  it('fija: sí/si/1/true/x = fija; no/0/false = a pedido; vacío = fija; otra cosa es error', () => {
    const valores = ['Sí', 'si', '1', 'TRUE', 'x', 'No', '0', 'false', '', 'quizás']
    // 9 pares (recorrido, cliente) distintos; la décima fila repite el primero pero falla antes por fija.
    const recs = ['Lunes · Rodrigo Lagos', 'Miércoles · Angelo', 'Viernes Angelo']
    const ruts = ['11111111-1', '22222222-2', '7654321-K']
    const r = importar(valores.map((v, i) => ({ recorrido: recs[i % 3], rut: ruts[Math.floor(i / 3) % 3], fija: v, orden: String(i) })))
    expect(r.asignaciones.map((a) => a.fija)).toEqual([true, true, true, true, true, false, false, false, true])
    expect(r.errores).toEqual([{ fila: 11, motivo: 'El valor "quizás" de la columna fija no es válido (usa sí o no).' }])
  })

  it('sin columna de fija u orden: todo fijo, y el orden es la posición de la fila dentro de su recorrido en el archivo', () => {
    const r = importar(
      [
        { recorrido: 'Lunes · Rodrigo Lagos', rut: '11111111-1' },
        { recorrido: 'Miércoles · Angelo', rut: '11111111-1' },
        { recorrido: 'Lunes · Rodrigo Lagos', rut: '22222222-2' },
        { recorrido: 'Lunes · Rodrigo Lagos', rut: '7654321-K' },
      ],
      { recorrido: 'recorrido', rut: 'rut' },
    )
    expect(r.asignaciones).toEqual([
      { clienteId: 'c1', recorridoId: 'lunR', fija: true, orden: 1 },
      { clienteId: 'c1', recorridoId: 'mieA', fija: true, orden: 1 },
      { clienteId: 'c2', recorridoId: 'lunR', fija: true, orden: 2 },
      { clienteId: 'c3', recorridoId: 'lunR', fija: true, orden: 3 },
    ])
  })

  it('orden vacío en algunas filas: usa la posición de la fila en su recorrido (contando también las que traen orden)', () => {
    const r = importar([
      { recorrido: 'Lunes · Rodrigo Lagos', rut: '11111111-1', fija: '', orden: '10' },
      { recorrido: 'Lunes · Rodrigo Lagos', rut: '22222222-2', fija: '', orden: '' },
    ])
    expect(r.asignaciones.map((a) => a.orden)).toEqual([10, 2])
  })

  it('reporta con número de fila: recorrido o cliente desconocido, RUT inválido, faltantes y orden no numérico; las buenas se importan', () => {
    const r = importar([
      { recorrido: 'Martes · Nadie', rut: '11111111-1', fija: '', orden: '' },
      { recorrido: 'Lunes · Rodrigo Lagos', rut: '33.333.333-3', fija: '', orden: '' },
      { recorrido: 'Lunes · Rodrigo Lagos', rut: 'abc', fija: '', orden: '' },
      { recorrido: '', rut: '11111111-1', fija: '', orden: '' },
      { recorrido: 'Lunes · Rodrigo Lagos', rut: '', fija: '', orden: '' },
      { recorrido: 'Lunes · Rodrigo Lagos', rut: '11111111-1', fija: '', orden: 'primero' },
      { recorrido: 'Lunes · Rodrigo Lagos', rut: '11111111-1', fija: '', orden: '-1' },
      { recorrido: 'Lunes · Rodrigo Lagos', rut: '11111111-1', fija: '', orden: '2.5' },
      { recorrido: '', rut: '', fija: '', orden: '' },
      { recorrido: 'Lunes · Rodrigo Lagos', rut: '11111111-1', fija: 'si', orden: '3' },
    ])
    expect(r.errores).toEqual([
      { fila: 2, motivo: 'El recorrido "Martes · Nadie" no existe. Créalo en la pestaña Recorridos o revisa cómo está escrito.' },
      { fila: 3, motivo: 'No hay ningún cliente con RUT 33333333-3. Impórtalo primero en la lista de clientes.' },
      { fila: 4, motivo: 'El RUT "abc" no es válido.' },
      { fila: 5, motivo: 'Falta el recorrido.' },
      { fila: 6, motivo: 'Falta el RUT.' },
      { fila: 7, motivo: 'El orden "primero" no es válido (usa un número entero: 0, 1, 2…).' },
      { fila: 8, motivo: 'El orden "-1" no es válido (usa un número entero: 0, 1, 2…).' },
      { fila: 9, motivo: 'El orden "2.5" no es válido (usa un número entero: 0, 1, 2…).' },
    ])
    expect(r.asignaciones).toEqual([{ clienteId: 'c1', recorridoId: 'lunR', fija: true, orden: 3 }])
  })

  it('el mismo cliente dos veces en el mismo recorrido: la segunda fila es error y se conserva la primera', () => {
    const r = importar([
      { recorrido: 'Lunes · Rodrigo Lagos', rut: '11111111-1', fija: 'si', orden: '1' },
      { recorrido: 'Miércoles · Angelo', rut: '11111111-1', fija: 'si', orden: '1' },
      { recorrido: 'lunes · rodrigo lagos', rut: '11.111.111-1', fija: 'no', orden: '9' },
    ])
    expect(r.asignaciones).toEqual([
      { clienteId: 'c1', recorridoId: 'lunR', fija: true, orden: 1 },
      { clienteId: 'c1', recorridoId: 'mieA', fija: true, orden: 1 },
    ])
    expect(r.errores).toEqual([{ fila: 4, motivo: 'Cliente repetido en este recorrido: ya aparece en la fila 2.' }])
  })

  it('dos recorridos con el mismo nombre (sin contar tildes): la fila es error, no se adivina', () => {
    const r = importarAsignaciones(
      [{ recorrido: 'Norte', rut: '11111111-1' }],
      { recorrido: 'recorrido', rut: 'rut' },
      [{ id: 'a', nombre: 'Norte', dia: 1, camioneta: 'C1', lejano: false }, { id: 'b', nombre: 'NORTE', dia: 2, camioneta: 'C1', lejano: false }],
      clientes,
    )
    expect(r.asignaciones).toEqual([])
    expect(r.errores).toEqual([{ fila: 2, motivo: 'Hay más de un recorrido llamado "Norte". Cambia el nombre de uno de ellos en la pestaña Recorridos.' }])
  })

  it('lee un archivo de Excel con BOM y separador ; (como la plantilla)', () => {
    const texto = BOM + 'recorrido;rut;fija;orden\r\nLunes · Rodrigo Lagos;11.111.111-1;sí;1\r\nMiércoles · Angelo;22.222.222-2;no;\r\n'
    const bytes = new TextEncoder().encode(texto)
    const r = importar(parsearCsv(decodificarArchivo(bytes.buffer as ArrayBuffer)))
    expect(r.errores).toEqual([])
    expect(r.asignaciones).toEqual([
      { clienteId: 'c1', recorridoId: 'lunR', fija: true, orden: 1 },
      { clienteId: 'c2', recorridoId: 'mieA', fija: false, orden: 1 },
    ])
  })

  it('una columna elegida que no existe se informa una sola vez', () => {
    const r = importar([{ recorrido: 'x', rut: '1-9' }], { recorrido: 'Ruta', rut: 'rut' })
    expect(r).toEqual({ asignaciones: [], errores: [{ fila: 0, motivo: 'La columna "Ruta" no existe en el archivo.' }] })
  })
})

describe('docs/plantilla-asignaciones.csv (datos sintéticos)', () => {
  it('se importa sin errores contra sus recorridos y clientes de ejemplo', () => {
    const filas = parsearCsv(decodificarArchivo(new TextEncoder().encode(plantilla).buffer as ArrayBuffer))
    const recorridos: Recorrido[] = ['Lunes · Chofer Uno', 'Miércoles · Chofer Uno', 'Miércoles · Chofer Dos', 'Viernes · Chofer Dos'].map((nombre, i) => ({
      id: `r${i}`, nombre, dia: ([1, 3, 3, 5] as const)[i], camioneta: 'C', lejano: false,
    }))
    const clientes: Cliente[] = ['11111111-1', '22222222-2', '33333333-3', '44444444-4'].map((rut, i) => ({ id: `c${i}`, nombre: `Cliente ${i}`, rut }))
    const r = importarAsignaciones(filas, { recorrido: 'recorrido', rut: 'rut', fija: 'fija', orden: 'orden' }, recorridos, clientes)
    expect(r.errores).toEqual([])
    expect(r.asignaciones).toHaveLength(6)
    expect(r.asignaciones.filter((a) => a.clienteId === 'c0').map((a) => a.recorridoId)).toEqual(['r0', 'r1', 'r3'])
    expect(r.asignaciones.find((a) => a.clienteId === 'c3')).toEqual({ clienteId: 'c3', recorridoId: 'r3', fija: false, orden: 2 })
  })
})
