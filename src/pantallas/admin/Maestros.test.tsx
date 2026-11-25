import { describe, it, expect } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Maestros from './Maestros'
import { crearMemoryRepo } from '../../data/memoryRepo'

const CSV_CLIENTES =
  '﻿Razón Social;Rut Cliente;Giro\r\n' +
  '"Imprenta ""Sur"", Ltda.";76.123.456-7;Imprenta\r\n' +
  'Ñandú SpA;12.345.678-5;Libros\r\n' +
  ';11.111.111-1;Sin nombre\r\n' +
  'Sin rut;;Otro\r\n' +
  'Repetida;76123456-7;Otro\r\n'

function archivo(contenido: string | Uint8Array, nombre = 'clientes.csv') {
  return new File([contenido as BlobPart], nombre, { type: 'text/csv' })
}

describe('Maestros: clientes', () => {
  it('sube un CSV, elige columnas de nombre y RUT, y lista los clientes importados y los errores por fila', async () => {
    const repo = crearMemoryRepo()
    render(<Maestros repo={repo} />)
    await userEvent.upload(await screen.findByLabelText('Archivo de clientes (CSV)'), archivo(CSV_CLIENTES))

    await userEvent.selectOptions(await screen.findByLabelText('Columna del nombre'), 'Razón Social')
    await userEvent.selectOptions(screen.getByLabelText('Columna del RUT'), 'Rut Cliente')
    await userEvent.click(screen.getByRole('button', { name: 'Importar clientes' }))

    expect(await screen.findByText('2 clientes nuevos, 0 actualizados, 0 sin cambios.')).toBeInTheDocument()
    const errores = screen.getByRole('list', { name: 'Errores de importación' })
    expect(within(errores).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Fila 4: Falta el nombre.',
      'Fila 5: Falta el RUT.',
      'Fila 6: RUT duplicado: ya aparece en la fila 2.',
    ])
    const lista = screen.getByRole('list', { name: 'Clientes' })
    expect(within(lista).getByText('Imprenta "Sur", Ltda.')).toBeInTheDocument()
    expect(within(lista).getByText('Ñandú SpA')).toBeInTheDocument()
    expect(within(lista).getByText('12345678-5')).toBeInTheDocument()
    expect((await repo.listarClientes()).map((c) => c.rut).sort()).toEqual(['12345678-5', '76123456-7'])
  })

  it('después de leer el archivo vacía el selector: volver a elegir el mismo archivo (corregido) se vuelve a leer', async () => {
    const repo = crearMemoryRepo()
    render(<Maestros repo={repo} />)
    const input = (await screen.findByLabelText('Archivo de clientes (CSV)')) as HTMLInputElement
    await userEvent.upload(input, archivo('Nombre;RUT\nUno;abc\n'))
    expect(input.value).toBe('')
    await userEvent.selectOptions(await screen.findByLabelText('Columna del nombre'), 'Nombre')
    await userEvent.selectOptions(screen.getByLabelText('Columna del RUT'), 'RUT')
    await userEvent.click(screen.getByRole('button', { name: 'Importar clientes' }))
    expect(await screen.findByText(/El RUT "abc" no es válido/)).toBeInTheDocument()
    expect(screen.getByText('1 fila no se importó:')).toBeInTheDocument()
    // Se corrige el archivo en Excel y se elige de nuevo con el mismo nombre.
    await userEvent.upload(input, archivo('Nombre;RUT\nUno;1-9\n'))
    await userEvent.selectOptions(await screen.findByLabelText('Columna del nombre'), 'Nombre')
    await userEvent.selectOptions(screen.getByLabelText('Columna del RUT'), 'RUT')
    await userEvent.click(screen.getByRole('button', { name: 'Importar clientes' }))
    expect(await screen.findByText('1 cliente nuevo, 0 actualizados, 0 sin cambios.')).toBeInTheDocument()
  })

  it('un archivo guardado por Excel en Windows-1252 conserva la ñ y las tildes', async () => {
    const texto = 'Nombre;RUT\r\nPeña y Cía;12.345.678-5\r\n'
    const latin1 = Uint8Array.from(texto, (c) => c.charCodeAt(0))
    const repo = crearMemoryRepo()
    render(<Maestros repo={repo} />)
    await userEvent.upload(await screen.findByLabelText('Archivo de clientes (CSV)'), archivo(latin1))
    await userEvent.selectOptions(await screen.findByLabelText('Columna del nombre'), 'Nombre')
    await userEvent.selectOptions(screen.getByLabelText('Columna del RUT'), 'RUT')
    await userEvent.click(screen.getByRole('button', { name: 'Importar clientes' }))
    expect(await screen.findByText('1 cliente nuevo, 0 actualizados, 0 sin cambios.')).toBeInTheDocument()
    expect((await repo.listarClientes())[0].nombre).toBe('Peña y Cía')
  })

  it('importar el mismo archivo otra vez actualiza y no duplica', async () => {
    const repo = crearMemoryRepo()
    render(<Maestros repo={repo} />)
    for (const esperado of ['1 cliente nuevo, 0 actualizados, 0 sin cambios.', '0 clientes nuevos, 0 actualizados, 1 sin cambios.']) {
      await userEvent.upload(await screen.findByLabelText('Archivo de clientes (CSV)'), archivo('Nombre;RUT\nUno;1-9\n'))
      await userEvent.selectOptions(await screen.findByLabelText('Columna del nombre'), 'Nombre')
      await userEvent.selectOptions(screen.getByLabelText('Columna del RUT'), 'RUT')
      await userEvent.click(screen.getByRole('button', { name: 'Importar clientes' }))
      expect(await screen.findByText(esperado)).toBeInTheDocument()
    }
    expect(await repo.listarClientes()).toHaveLength(1)
  })

  it('no deja importar hasta elegir las dos columnas y avisa si el archivo no tiene filas', async () => {
    render(<Maestros repo={crearMemoryRepo()} />)
    await userEvent.upload(await screen.findByLabelText('Archivo de clientes (CSV)'), archivo('Nombre;RUT\n'))
    expect(await screen.findByText('El archivo no tiene filas para importar.')).toBeInTheDocument()
    await userEvent.upload(screen.getByLabelText('Archivo de clientes (CSV)'), archivo('A;B\nUno;1-9\n'))
    const importar = await screen.findByRole('button', { name: 'Importar clientes' })
    expect(importar).toBeDisabled()
    await userEvent.selectOptions(screen.getByLabelText('Columna del nombre'), 'A')
    expect(importar).toBeDisabled()
    await userEvent.selectOptions(screen.getByLabelText('Columna del RUT'), 'B')
    expect(importar).toBeEnabled()
  })

  it('adivina las columnas por su encabezado', async () => {
    render(<Maestros repo={crearMemoryRepo()} />)
    await userEvent.upload(await screen.findByLabelText('Archivo de clientes (CSV)'), archivo(CSV_CLIENTES))
    expect(await screen.findByLabelText('Columna del nombre')).toHaveValue('Razón Social')
    expect(screen.getByLabelText('Columna del RUT')).toHaveValue('Rut Cliente')
  })
})

describe('Maestros: recorridos y asignación', () => {
  it('crea un recorrido con día, chofer y lejano; con el nombre vacío se llama "Día · Chofer" y el formulario queda listo para el día siguiente', async () => {
    const repo = crearMemoryRepo()
    render(<Maestros repo={repo} />)
    await userEvent.click(await screen.findByRole('tab', { name: 'Recorridos' }))
    await userEvent.type(screen.getByLabelText('Nombre del recorrido'), 'Miércoles Rancagua')
    await userEvent.selectOptions(screen.getByLabelText('Día'), 'Miércoles')
    await userEvent.type(screen.getByLabelText('Camioneta'), 'Camioneta 2')
    await userEvent.type(screen.getByLabelText('Chofer titular (opcional)'), 'Rodrigo Lagos')
    await userEvent.click(screen.getByLabelText('Lejano'))
    await userEvent.click(screen.getByRole('button', { name: 'Guardar recorrido' }))
    expect(await screen.findByText('Miércoles Rancagua · Miércoles · Camioneta 2 · Chofer: Rodrigo Lagos · lejano')).toBeInTheDocument()
    expect(await repo.listarRecorridos()).toMatchObject([{ nombre: 'Miércoles Rancagua', dia: 3, camioneta: 'Camioneta 2', lejano: true, chofer: 'Rodrigo Lagos' }])
    // Rápido: chofer y camioneta se conservan, el día avanza y el nombre vacío se arma solo.
    expect(screen.getByLabelText('Día')).toHaveValue('4')
    expect(screen.getByLabelText('Nombre del recorrido')).toHaveValue('')
    expect(screen.getByLabelText('Chofer titular (opcional)')).toHaveValue('Rodrigo Lagos')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar recorrido' }))
    expect(await screen.findByText('Jueves · Rodrigo Lagos · Jueves · Camioneta 2 · Chofer: Rodrigo Lagos · lejano')).toBeInTheDocument()
    expect(screen.getByLabelText('Día')).toHaveValue('5')
  })

  it('asigna un cliente a varios recorridos (fijo o a pedido, con orden) y lo quita de uno', async () => {
    const repo = crearMemoryRepo({
      clientes: [{ id: 'c1', nombre: 'Librería Uno', rut: '1-9' }, { id: 'c2', nombre: 'Otra', rut: '2-7' }],
      recorridos: [
        { id: 'lun', nombre: 'Lunes · Rodrigo Lagos', dia: 1, camioneta: 'C1', lejano: false },
        { id: 'mie', nombre: 'Miércoles · Angelo', dia: 3, camioneta: 'C2', lejano: true },
      ],
      asignaciones: [{ clienteId: 'c2', recorridoId: 'mie', fija: true, orden: 3 }],
    })
    render(<Maestros repo={repo} />)
    const panel = await screen.findByRole('group', { name: 'Recorridos de Librería Uno' })
    expect(within(panel).getByText('Sin recorrido.')).toBeInTheDocument()
    await userEvent.selectOptions(within(panel).getByLabelText('Agregar Librería Uno a un recorrido'), 'Miércoles · Angelo (Miércoles, lejano)')
    await userEvent.click(within(panel).getByRole('button', { name: 'Agregar' }))
    // entra al final del recorrido (después del orden 3 de "Otra"), como fijo
    expect(await within(panel).findByLabelText('Orden en Miércoles · Angelo')).toHaveValue(4)
    await userEvent.selectOptions(within(panel).getByLabelText('Agregar Librería Uno a un recorrido'), 'Lunes · Rodrigo Lagos (Lunes)')
    await userEvent.click(within(panel).getByRole('button', { name: 'Agregar' }))
    expect(await within(panel).findByLabelText('Orden en Lunes · Rodrigo Lagos')).toHaveValue(1)
    // ya no se ofrecen los recorridos que tiene
    expect(within(panel).queryByLabelText('Agregar Librería Uno a un recorrido')).not.toBeInTheDocument()

    await userEvent.click(within(panel).getByLabelText('Fijo en Lunes · Rodrigo Lagos'))
    expect(await within(panel).findByText('a pedido')).toBeInTheDocument()
    const orden = within(panel).getByLabelText('Orden en Lunes · Rodrigo Lagos')
    await userEvent.clear(orden)
    await userEvent.type(orden, '7')
    await userEvent.tab()
    await waitFor(async () =>
      expect((await repo.listarAsignaciones()).filter((a) => a.clienteId === 'c1')).toEqual([
        { clienteId: 'c1', recorridoId: 'mie', fija: true, orden: 4 },
        { clienteId: 'c1', recorridoId: 'lun', fija: false, orden: 7 },
      ]),
    )
    await userEvent.click(within(panel).getByRole('button', { name: 'Quitar Librería Uno de Miércoles · Angelo' }))
    await waitFor(async () => expect((await repo.listarAsignaciones()).filter((a) => a.clienteId === 'c1')).toEqual([
      { clienteId: 'c1', recorridoId: 'lun', fija: false, orden: 7 },
    ]))
    expect(within(panel).queryByLabelText('Orden en Miércoles · Angelo')).not.toBeInTheDocument()
  })

  it('un orden inválido no se guarda y se avisa en español', async () => {
    const repo = crearMemoryRepo({
      clientes: [{ id: 'c1', nombre: 'Librería Uno', rut: '1-9' }],
      recorridos: [{ id: 'lun', nombre: 'Lunes', dia: 1, camioneta: 'C1', lejano: false }],
      asignaciones: [{ clienteId: 'c1', recorridoId: 'lun', fija: true, orden: 2 }],
    })
    render(<Maestros repo={repo} />)
    const orden = await screen.findByLabelText('Orden en Lunes')
    await userEvent.clear(orden)
    await userEvent.type(orden, '-3')
    await userEvent.tab()
    expect(await screen.findByRole('alert')).toHaveTextContent('El orden debe ser un número entero de 0 a 100000.')
    expect(await repo.listarAsignaciones()).toEqual([{ clienteId: 'c1', recorridoId: 'lun', fija: true, orden: 2 }])
  })

  it('quien no es de gestión ve los recorridos del cliente pero no puede cambiarlos', async () => {
    const repo = crearMemoryRepo({
      usuario: { id: 'u', nombre: 'Pedro', rol: 'chofer' },
      clientes: [{ id: 'c1', nombre: 'Librería Uno', rut: '1-9' }],
      recorridos: [{ id: 'lun', nombre: 'Lunes', dia: 1, camioneta: 'C1', lejano: false }],
      asignaciones: [{ clienteId: 'c1', recorridoId: 'lun', fija: false, orden: 2 }],
    })
    render(<Maestros repo={repo} usuario={{ id: 'u', nombre: 'Pedro', rol: 'chofer' }} />)
    const panel = await screen.findByRole('group', { name: 'Recorridos de Librería Uno' })
    expect(within(panel).getByText('Lunes (Lunes) · a pedido · orden 2')).toBeInTheDocument()
    expect(within(panel).queryByRole('button')).not.toBeInTheDocument()
    expect(within(panel).queryByRole('checkbox')).not.toBeInTheDocument()
    expect(within(panel).queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Archivo de recorridos de clientes (CSV)')).not.toBeInTheDocument()
  })

  it('importa las asignaciones desde un CSV (recorrido;rut;fija;orden): nuevas, errores por fila e idempotente', async () => {
    const repo = crearMemoryRepo({
      clientes: [{ id: 'c1', nombre: 'Librería Uno', rut: '11.111.111-1' }, { id: 'c2', nombre: 'Otra', rut: '22222222-2' }],
      recorridos: [
        { id: 'lun', nombre: 'Lunes · Rodrigo Lagos', dia: 1, camioneta: 'C1', lejano: false },
        { id: 'mie', nombre: 'Miércoles · Angelo', dia: 3, camioneta: 'C2', lejano: false },
      ],
    })
    render(<Maestros repo={repo} />)
    const csv = '\uFEFFrecorrido;rut;fija;orden\r\nLUNES · RODRIGO LAGOS;11111111-1;sí;1\r\nmiercoles · angelo;22.222.222-2;no;\r\nMartes · Nadie;11111111-1;;\r\nLunes · Rodrigo Lagos;33.333.333-3;;\r\n'
    const input = (await screen.findByLabelText('Archivo de recorridos de clientes (CSV)')) as HTMLInputElement
    for (const esperado of [
      '2 asignaciones nuevas, 0 actualizadas, 0 sin cambios, 2 errores.',
      '0 asignaciones nuevas, 0 actualizadas, 2 sin cambios, 2 errores.',
    ]) {
      await userEvent.upload(input, archivo(csv, 'asignaciones.csv'))
      expect(input.value).toBe('')
      // las columnas se adivinan por el encabezado
      expect(await screen.findByLabelText('Columna del recorrido')).toHaveValue('recorrido')
      expect(screen.getByLabelText('Columna del RUT del cliente')).toHaveValue('rut')
      expect(screen.getByLabelText('Columna fija (opcional)')).toHaveValue('fija')
      expect(screen.getByLabelText('Columna del orden (opcional)')).toHaveValue('orden')
      await userEvent.click(screen.getByRole('button', { name: 'Importar recorridos de clientes' }))
      expect(await screen.findByText(esperado)).toBeInTheDocument()
    }
    expect(within(screen.getByRole('list', { name: 'Errores de importación' })).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Fila 4: El recorrido "Martes · Nadie" no existe. Créalo en la pestaña Recorridos o revisa cómo está escrito.',
      'Fila 5: No hay ningún cliente con RUT 33333333-3. Impórtalo primero en la lista de clientes.',
    ])
    expect(await repo.listarAsignaciones()).toEqual([
      { clienteId: 'c1', recorridoId: 'lun', fija: true, orden: 1 },
      { clienteId: 'c2', recorridoId: 'mie', fija: false, orden: 1 },
    ])
    expect(within(screen.getByRole('group', { name: 'Recorridos de Otra' })).getByLabelText('Orden en Miércoles · Angelo')).toHaveValue(1)
  })

  it('edita un recorrido existente sin crear otro', async () => {
    const repo = crearMemoryRepo({ recorridos: [{ id: 'r1', nombre: 'Lunes', dia: 1, camioneta: 'A', lejano: false }] })
    render(<Maestros repo={repo} />)
    await userEvent.click(await screen.findByRole('tab', { name: 'Recorridos' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Editar Lunes' }))
    await userEvent.click(screen.getByLabelText('Lejano'))
    await userEvent.click(screen.getByRole('button', { name: 'Guardar recorrido' }))
    expect(await screen.findByText('Lunes · Lunes · A · lejano')).toBeInTheDocument()
    expect(await repo.listarRecorridos()).toHaveLength(1)
  })

  it('pide un nombre antes de guardar', async () => {
    render(<Maestros repo={crearMemoryRepo()} />)
    await userEvent.click(await screen.findByRole('tab', { name: 'Recorridos' }))
    await userEvent.click(screen.getByRole('button', { name: 'Guardar recorrido' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Escribe el nombre del recorrido.')
  })
})

describe('Maestros: productos', () => {
  it('importa el catálogo con área por defecto y lista los productos y errores', async () => {
    const repo = crearMemoryRepo()
    render(<Maestros repo={repo} />)
    await userEvent.click(await screen.findByRole('tab', { name: 'Productos' }))
    await userEvent.upload(
      screen.getByLabelText('Archivo de productos (CSV)'),
      archivo('Código;Descripción\r\nA-1;Cuchillo de chef\r\n;Sin código\r\nA-2;Tijera\r\n', 'productos.csv'),
    )
    await userEvent.selectOptions(await screen.findByLabelText('Columna del código'), 'Código')
    await userEvent.selectOptions(screen.getByLabelText('Columna del nombre'), 'Descripción')
    await userEvent.selectOptions(screen.getByLabelText('Área de todos los productos'), 'Afilado')
    await userEvent.click(screen.getByRole('button', { name: 'Importar productos' }))
    expect(await screen.findByText('2 productos nuevos, 0 actualizados, 0 sin cambios.')).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Errores de importación' })).toHaveTextContent('Fila 3: Falta el código.')
    expect(within(screen.getByRole('list', { name: 'Productos' })).getByText('Cuchillo de chef')).toBeInTheDocument()
    expect((await repo.listarProductos()).map((p) => p.area)).toEqual(['afilado', 'afilado'])
  })
})
