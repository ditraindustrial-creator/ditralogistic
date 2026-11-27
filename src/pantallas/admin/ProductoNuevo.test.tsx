import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Maestros from './Maestros'
import { crearMemoryRepo } from '../../data/memoryRepo'
import { validarProductoNuevo } from '../../dominio/maestros'

const existente = { id: 'p1', codigo: 'CU-20', nombre: 'Cuchillo 20 cm', area: 'afilado', tipo: 'herramienta' } as const

describe('validarProductoNuevo', () => {
  it('pide código y nombre y no repite códigos', () => {
    expect(validarProductoNuevo({ codigo: ' ', nombre: '', area: 'afilado', tipo: 'herramienta' }, [])).toEqual([
      'Escribe el código del producto.',
      'Escribe el nombre del producto.',
    ])
    expect(validarProductoNuevo({ codigo: 'CU-20', nombre: 'Otro', area: 'afilado', tipo: 'herramienta' }, [existente])).toEqual([
      'Ya existe un producto con el código CU-20: «Cuchillo 20 cm».',
    ])
  })
})

describe('Maestros: nuevo producto', () => {
  it('con el botón «+ Nuevo producto» agrega uno con código, nombre, área y tipo, y queda listo para el siguiente', async () => {
    const repo = crearMemoryRepo({ productos: [existente] })
    render(<Maestros repo={repo} />)
    await userEvent.click(screen.getByRole('tab', { name: 'Productos' }))
    await userEvent.click(screen.getByRole('button', { name: '+ Nuevo producto' }))

    await userEvent.type(screen.getByLabelText('Código'), 'LI-9')
    await userEvent.type(screen.getByLabelText('Nombre'), 'Empaste tapa dura')
    await userEvent.click(screen.getByLabelText('Encuadernación'))
    await userEvent.click(screen.getByLabelText(/Servicio/))
    await userEvent.click(screen.getByRole('button', { name: 'Guardar producto' }))

    expect(await screen.findByText('Producto «Empaste tapa dura» (LI-9) agregado.')).toBeInTheDocument()
    expect(await repo.listarProductos()).toContainEqual(expect.objectContaining({ codigo: 'LI-9', nombre: 'Empaste tapa dura', area: 'encuadernacion', tipo: 'servicio' }))
    expect(screen.getByLabelText('Código')).toHaveValue('')
    expect(await screen.findByText('Empaste tapa dura')).toBeInTheDocument()
  })

  it('no guarda un código que ya existe', async () => {
    const repo = crearMemoryRepo({ productos: [existente] })
    render(<Maestros repo={repo} />)
    await userEvent.click(screen.getByRole('tab', { name: 'Productos' }))
    await userEvent.click(screen.getByRole('button', { name: '+ Nuevo producto' }))
    await userEvent.type(screen.getByLabelText('Código'), 'CU-20')
    await userEvent.type(screen.getByLabelText('Nombre'), 'Otro')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar producto' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Ya existe un producto con el código CU-20')
    expect(await repo.listarProductos()).toHaveLength(1)
  })
})
