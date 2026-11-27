import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PantallaRecepcion from './PantallaRecepcion'
import { crearMemoryRepo } from '../../data/memoryRepo'
import type { Etapa, Linea, Movimiento, Trabajo, UsuarioActual } from '../../dominio/tipos'
import { sigueEnRecepcion, trabajosEnRecepcion, validarEdicionTrabajo } from '../../dominio/trabajo'

const etapas: Etapa[] = [
  { id: 'a1', area: 'afilado', orden: 1, nombre: 'Recibido', esListo: false, esFinal: false },
  { id: 'a2', area: 'afilado', orden: 2, nombre: 'En taller', esListo: false, esFinal: false },
]
const secretaria: UsuarioActual = { id: 'u1', nombre: 'Sec', rol: 'secretaria' }
const chofer: UsuarioActual = { id: 'u2', nombre: 'Pedro', rol: 'chofer' }
const base = { entrada: 'cliente', salida: 'cliente', recibidoEn: '2026-11-27T12:00:00Z', urgente: false } as const

function datos() {
  const trabajos: Trabajo[] = [
    { id: 't1', numero: 1, clienteId: 'c1', area: 'afilado', ...base, notas: 'frágil' },
    { id: 't2', numero: 2, clienteId: 'c1', area: 'afilado', ...base },
  ]
  const lineas: Linea[] = [
    { id: 'l1', trabajoId: 't1', producto: 'Cuchillo', cantidad: 10, nota: '20 cm' },
    { id: 'l2', trabajoId: 't1', producto: 'Tijera', cantidad: 3 },
    { id: 'l3', trabajoId: 't2', producto: 'Formón', cantidad: 4 },
  ]
  const mov = (id: string, lineaId: string, cantidad: number, origen: string | null, destino: string): Movimiento => ({
    id, lineaId, cantidad, etapaOrigenId: origen, etapaDestinoId: destino, usuarioId: 'u2', creadoEn: '2026-11-27T12:00:00Z',
  })
  const movimientos = [mov('m1', 'l1', 10, null, 'a1'), mov('m2', 'l2', 3, null, 'a1'), mov('m3', 'l3', 4, null, 'a1'), mov('m4', 'l3', 1, 'a1', 'a2')]
  return { trabajos, lineas, movimientos }
}

function montar(usuario = secretaria) {
  const d = datos()
  const repo = crearMemoryRepo({
    usuario, etapas, ...d,
    clientes: [
      { id: 'c1', nombre: 'Imprenta Sur Ltda.', rut: '76123456-7' },
      { id: 'c2', nombre: 'Ñandú SpA', rut: '12345678-5' },
    ],
  })
  render(<PantallaRecepcion repo={repo} usuario={usuario} />)
  return { repo }
}

describe('dominio: edición en Recepción', () => {
  it('un trabajo sigue en Recepción solo si ninguna pieza se movió', () => {
    const d = datos()
    expect(sigueEnRecepcion('t1', d.lineas, d.movimientos)).toBe(true)
    expect(sigueEnRecepcion('t2', d.lineas, d.movimientos)).toBe(false)
    expect(trabajosEnRecepcion(d.trabajos, d.lineas, d.movimientos).map((t) => t.id)).toEqual(['t1'])
  })
  it('valida como un trabajo nuevo y no acepta líneas repetidas', () => {
    expect(validarEdicionTrabajo({ clienteId: '', lineas: [] })).toEqual(['Elige el cliente.', 'Agrega al menos una línea.'])
    expect(validarEdicionTrabajo({ clienteId: 'c1', lineas: [{ id: 'l1', producto: 'a', cantidad: 1 }, { id: 'l1', producto: 'b', cantidad: 0 }] })).toEqual([
      'La cantidad de la línea 2 debe ser un número entero mayor que cero.',
      'La línea 2 está repetida.',
    ])
  })
})

describe('Recepción: editar recibidos', () => {
  it('el chofer no ve la pestaña de edición', () => {
    montar(chofer)
    expect(screen.queryByRole('tab', { name: 'Editar recibidos' })).not.toBeInTheDocument()
  })

  it('lista solo los trabajos que siguen en Recepción y edita cliente, cantidad, detalle y líneas', async () => {
    const { repo } = montar()
    await userEvent.click(screen.getByRole('tab', { name: 'Editar recibidos' }))
    const lista = await screen.findByRole('list', { name: 'Trabajos en Recepción' })
    expect(within(lista).getAllByRole('listitem')).toHaveLength(1)
    expect(within(lista).getByText(/N\.º 1/)).toBeInTheDocument()

    await userEvent.click(within(lista).getByRole('button', { name: 'Editar trabajo 1' }))
    expect(await screen.findByText('Editando trabajo N.º 1')).toBeInTheDocument()
    expect(screen.getByLabelText('Producto línea 1')).toHaveValue('Cuchillo')
    expect(screen.getByLabelText('Detalle línea 1')).toHaveValue('20 cm')
    expect(screen.getByLabelText('Notas (opcional)')).toHaveValue('frágil')

    await userEvent.click(screen.getByRole('button', { name: 'Cambiar cliente' }))
    await userEvent.type(await screen.findByLabelText('Cliente'), 'ñan')
    await userEvent.click(await screen.findByRole('button', { name: /Ñandú/ }))
    await userEvent.clear(screen.getByLabelText('Cantidad línea 1'))
    await userEvent.type(screen.getByLabelText('Cantidad línea 1'), '8')
    await userEvent.clear(screen.getByLabelText('Detalle línea 1'))
    await userEvent.type(screen.getByLabelText('Detalle línea 1'), 'Ø14 blanco')
    await userEvent.click(screen.getByRole('button', { name: 'Quitar línea 2' }))
    await userEvent.click(screen.getByRole('button', { name: 'Agregar línea' }))
    await userEvent.type(screen.getByLabelText('Producto línea 2'), 'Hacha')
    await userEvent.type(screen.getByLabelText('Cantidad línea 2'), '1')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    expect(await screen.findByText('Trabajo N.º 1 actualizado')).toBeInTheDocument()
    const todo = await repo.cargarTodo()
    expect(todo.trabajos.find((t) => t.id === 't1')?.clienteId).toBe('c2')
    const suyas = todo.lineas.filter((l) => l.trabajoId === 't1')
    expect(suyas.map((l) => [l.producto, l.cantidad, l.nota])).toEqual([
      ['Cuchillo', 8, 'Ø14 blanco'],
      ['Hacha', 1, undefined],
    ])
    const recepciones = todo.movimientos.filter((m) => suyas.some((l) => l.id === m.lineaId))
    expect(recepciones.map((m) => [m.cantidad, m.etapaDestinoId])).toEqual([[8, 'a1'], [1, 'a1']])
    expect(todo.movimientos.some((m) => m.lineaId === 'l2')).toBe(false)

    await userEvent.click(screen.getByRole('button', { name: 'Volver a la lista' }))
    expect(await screen.findByRole('list', { name: 'Trabajos en Recepción' })).toBeInTheDocument()
  })

  it('si una pieza pasó al taller mientras se editaba, muestra el aviso y no cambia nada', async () => {
    const { repo } = montar()
    await userEvent.click(screen.getByRole('tab', { name: 'Editar recibidos' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Editar trabajo 1' }))
    await repo.moverUnidades('l1', 1, 'a1', 'a2')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('ya tiene piezas en el taller')
  })
})
