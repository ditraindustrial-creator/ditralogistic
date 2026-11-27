import { describe, it, expect } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Taller from './Taller'
import { crearMemoryRepo } from '../../data/memoryRepo'
import type { Etapa, Movimiento, Rol, Trabajo } from '../../dominio/tipos'

const etapas: Etapa[] = [
  { id: 'a1', area: 'afilado', orden: 1, nombre: 'Recibido', esListo: false, esFinal: false },
  { id: 'a2', area: 'afilado', orden: 2, nombre: 'Listo', esListo: true, esFinal: false },
  { id: 'b1', area: 'encuadernacion', orden: 1, nombre: 'Recibido', esListo: false, esFinal: false },
  { id: 'b2', area: 'encuadernacion', orden: 2, nombre: 'Terminado', esListo: true, esFinal: false },
]
const trab = (id: string, numero: number, area: Trabajo['area'], extra: Partial<Trabajo> = {}): Trabajo => ({
  id, numero, numeroArea: numero, clienteId: 'c1', area, entrada: 'cliente', salida: 'cliente', recibidoEn: '2026-11-20T12:00:00Z', urgente: false, ...extra,
})
const mov = (id: string, lineaId: string, cantidad: number, d: string): Movimiento => ({
  id, lineaId, cantidad, etapaOrigenId: null, etapaDestinoId: d, usuarioId: 'u', creadoEn: '2026-11-20T12:00:00Z',
})

function montar(rol: Rol) {
  const usuario = { id: 'u', nombre: 'Ana', rol }
  const repo = crearMemoryRepo({
    usuario,
    etapas,
    clientes: [{ id: 'c1', nombre: 'Imprenta Sur', rut: '1-9' }],
    trabajos: [trab('t1', 11, 'afilado'), trab('t2', 12, 'encuadernacion', { entregaPlanificada: '2099-11-28T15:00' })],
    lineas: [
      { id: 'l1', trabajoId: 't1', producto: 'Cuchillo 20 cm', cantidad: 3 },
      { id: 'l2', trabajoId: 't2', producto: 'Libro', cantidad: 100 },
    ],
    movimientos: [mov('m1', 'l1', 3, 'a1'), mov('m2', 'l2', 100, 'b1')],
    productos: [
      { id: 'p1', codigo: 'S-1', nombre: 'Afilado recto', area: 'afilado', tipo: 'servicio' },
      { id: 'p2', codigo: 'H-1', nombre: 'Cuchillo 20 cm', area: 'afilado', tipo: 'herramienta' },
    ],
  })
  render(<Taller repo={repo} usuario={usuario} />)
  return repo
}

const abrir = async (producto: string) => {
  const boton = await screen.findByRole('button', { name: new RegExp(producto) })
  await userEvent.click(boton)
  return boton.closest('li')!
}

describe('Taller: detalle del taller', () => {
  it('el operario de afilado define servicio y detalle; se ve en la tarjeta', async () => {
    const repo = montar('operario_afilado')
    const fila = await abrir('Cuchillo 20 cm')
    const opciones = () => Array.from(fila.querySelectorAll('datalist option')).map((o) => (o as HTMLOptionElement).value)
    await waitFor(() => expect(opciones()).toEqual(['Afilado recto']))
    await userEvent.type(within(fila).getByLabelText('Servicio'), 'Afilado recto')
    await userEvent.type(within(fila).getByLabelText('Detalle técnico'), 'Ángulo 20°, melladura leve')
    await userEvent.click(within(fila).getByRole('button', { name: 'Guardar detalle' }))
    expect(await within(fila).findByText('Detalle guardado')).toBeInTheDocument()
    const linea = (await repo.cargarTodo()).lineas.find((l) => l.id === 'l1')!
    expect(linea).toMatchObject({ servicio: 'Afilado recto', detalleTaller: 'Ángulo 20°, melladura leve' })
    expect(await screen.findByText('Servicio: Afilado recto')).toBeInTheDocument()
  })

  it('el operario de afilado no ve la planificación (es de encuadernación)', async () => {
    montar('operario_afilado')
    await abrir('Cuchillo 20 cm')
    expect(screen.queryByText(/Entrega planificada/)).not.toBeInTheDocument()
  })
})

describe('Taller: horas planificadas de encuadernación', () => {
  it('muestra el plan en la tarjeta y el operario de encuadernación agrega dos parciales', async () => {
    const repo = montar('operario_encuadernacion')
    expect(await screen.findByText(/Entrega: Total: sáb 28\/11 15:00/)).toBeInTheDocument()
    const fila = await abrir('Libro')
    const plan = within(fila).getByRole('group', { name: /Entrega planificada · Trabajo E-012/ })
    expect(within(plan).getByLabelText('Trabajo completo')).toHaveValue('2099-11-28T15:00')

    await userEvent.click(within(plan).getByRole('button', { name: 'Agregar entrega parcial' }))
    await userEvent.click(within(plan).getByRole('button', { name: 'Agregar entrega parcial' }))
    await userEvent.type(within(plan).getByLabelText('Fecha y hora parcial 1'), '2099-11-27T10:00')
    await userEvent.type(within(plan).getByLabelText('Cantidad parcial 1'), '60')
    await userEvent.type(within(plan).getByLabelText('Fecha y hora parcial 2'), '2099-11-26T10:00')
    await userEvent.type(within(plan).getByLabelText('Cantidad parcial 2'), '40')
    await userEvent.type(within(plan).getByLabelText('Nota parcial 2'), 'primera tanda')
    await userEvent.click(within(plan).getByRole('button', { name: 'Guardar planificación' }))
    expect(await within(plan).findByText('Planificación guardada')).toBeInTheDocument()

    const datos = await repo.cargarTodo()
    expect(datos.entregasParciales?.map((p) => [p.planificada, p.cantidad, p.nota])).toEqual([
      ['2099-11-26T10:00', 40, 'primera tanda'],
      ['2099-11-27T10:00', 60, undefined],
    ])
    expect(await screen.findByText(/Parcial: jue 26\/11 10:00 \(40 u\.\) · Total: sáb 28\/11 15:00/)).toBeInTheDocument()
  })

  it('no deja guardar parciales que suman más que el trabajo, ni una parcial sin hora', async () => {
    const repo = montar('jefe_taller')
    const fila = await abrir('Libro')
    const plan = within(fila).getByRole('group', { name: /Entrega planificada/ })
    await userEvent.click(within(plan).getByRole('button', { name: 'Agregar entrega parcial' }))
    await userEvent.click(within(plan).getByRole('button', { name: 'Guardar planificación' }))
    expect(await within(plan).findByRole('alert')).toHaveTextContent('Falta la fecha y hora de la entrega parcial 1.')
    await userEvent.type(within(plan).getByLabelText('Fecha y hora parcial 1'), '2099-11-27T10:00')
    await userEvent.type(within(plan).getByLabelText('Cantidad parcial 1'), '150')
    await userEvent.click(within(plan).getByRole('button', { name: 'Guardar planificación' }))
    expect(await within(plan).findByRole('alert')).toHaveTextContent('Las entregas parciales suman 150 unidades, pero el trabajo tiene 100.')
    expect((await repo.cargarTodo()).entregasParciales).toEqual([])
  })

  it('quitar la hora total y las parciales deja el trabajo sin planificar', async () => {
    const repo = montar('secretaria')
    const fila = await abrir('Libro')
    const plan = within(fila).getByRole('group', { name: /Entrega planificada/ })
    await userEvent.clear(within(plan).getByLabelText('Trabajo completo'))
    await userEvent.click(within(plan).getByRole('button', { name: 'Guardar planificación' }))
    await within(plan).findByText('Planificación guardada')
    expect((await repo.cargarTodo()).trabajos.find((t) => t.id === 't2')?.entregaPlanificada).toBeUndefined()
    await waitFor(() => expect(screen.queryByText(/Entrega: Total/)).not.toBeInTheDocument())
  })
})
