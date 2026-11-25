import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
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
  it('crea un recorrido con día y marca lejano, y se lo asigna a un cliente', async () => {
    const repo = crearMemoryRepo({ clientes: [{ id: 'c1', nombre: 'Librería Uno', rut: '1-9', recorridoId: null }] })
    render(<Maestros repo={repo} />)
    await userEvent.click(await screen.findByRole('tab', { name: 'Recorridos' }))
    await userEvent.type(screen.getByLabelText('Nombre del recorrido'), 'Miércoles Rancagua')
    await userEvent.selectOptions(screen.getByLabelText('Día'), 'Miércoles')
    await userEvent.type(screen.getByLabelText('Camioneta'), 'Camioneta 2')
    await userEvent.click(screen.getByLabelText('Lejano'))
    await userEvent.click(screen.getByRole('button', { name: 'Guardar recorrido' }))
    expect(await screen.findByText('Miércoles Rancagua · Miércoles · Camioneta 2 · lejano')).toBeInTheDocument()
    expect(await repo.listarRecorridos()).toMatchObject([{ nombre: 'Miércoles Rancagua', dia: 3, camioneta: 'Camioneta 2', lejano: true }])

    await userEvent.click(screen.getByRole('tab', { name: 'Clientes' }))
    await userEvent.selectOptions(await screen.findByLabelText('Recorrido de Librería Uno'), 'Miércoles Rancagua (Miércoles, lejano)')
    expect((await repo.listarClientes())[0].recorridoId).toBe((await repo.listarRecorridos())[0].id)
    await userEvent.selectOptions(screen.getByLabelText('Recorrido de Librería Uno'), 'Sin recorrido')
    expect((await repo.listarClientes())[0].recorridoId).toBeNull()
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
