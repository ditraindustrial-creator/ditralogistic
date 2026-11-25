import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Reporte from './Reporte'
import { crearMemoryRepo } from '../../data/memoryRepo'
import type { Etapa, Linea, Movimiento, Trabajo } from '../../dominio/tipos'

const etapas: Etapa[] = [
  { id: 'e1', area: 'encuadernacion', orden: 1, nombre: 'Recibido', esListo: false, esFinal: false },
  { id: 'e2', area: 'encuadernacion', orden: 2, nombre: 'En producción', esListo: false, esFinal: false },
  { id: 'e3', area: 'encuadernacion', orden: 3, nombre: 'Terminado', esListo: true, esFinal: false },
]
const trab = (id: string, numero: number): Trabajo => ({
  id, numero, clienteId: 'c1', area: 'encuadernacion', entrada: 'cliente', salida: 'cliente', recibidoEn: '2026-11-20T12:00:00Z', urgente: false,
})
const lin = (id: string, trabajoId: string, cantidad: number, producto: string): Linea => ({ id, trabajoId, producto, cantidad })
const mov = (id: string, lineaId: string, cantidad: number, o: string | null, d: string, creadoEn: string): Movimiento => ({
  id, lineaId, cantidad, etapaOrigenId: o, etapaDestinoId: d, usuarioId: 'u', creadoEn,
})

function montar(movimientos: Movimiento[], planificado = false) {
  const repo = crearMemoryRepo({
    ...(planificado ? { entregasParciales: [{ id: 'p1', trabajoId: 't1', planificada: '2026-11-25T09:00', cantidad: 2 }] } : {}),
    usuario: { id: 'u', nombre: 'Ana', rol: 'jefe_taller' },
    etapas,
    clientes: [{ id: 'c1', nombre: 'Imprenta Sur', rut: '1-9' }],
    trabajos: [trab('t1', 11), trab('t2', 12)],
    lineas: [lin('l1', 't1', 3, 'Libro'), lin('l2', 't2', 2, 'Cuaderno')],
    movimientos,
  })
  render(<Reporte repo={repo} />)
  return repo
}
const seccion = (nombre: string) => screen.getByRole('region', { name: new RegExp(`^${nombre}`) })

describe('Reporte', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-24T15:00:00Z') })
  })
  afterEach(() => vi.useRealTimers())

  it('en cada fila de un trabajo con plan muestra la entrega planificada', async () => {
    montar([mov('m1', 'l1', 3, null, 'e1', '2026-11-24T12:00:00Z'), mov('m2', 'l2', 2, null, 'e1', '2026-11-24T12:00:00Z')], true)
    const recibido = await screen.findByRole('region', { name: /^Recién recibido/ })
    expect(within(recibido).getByText('Entrega planificada: Parcial: mié 25/11 09:00 (2 u.)')).toBeInTheDocument()
    expect(within(recibido).getAllByText(/Entrega planificada/)).toHaveLength(1)
  })

  it('muestra las cuatro listas del día de hoy con cantidades y horas', async () => {
    montar([
      mov('m1', 'l1', 3, null, 'e1', '2026-11-20T12:00:00Z'),
      mov('m2', 'l1', 3, 'e1', 'e3', '2026-11-24T13:15:00Z'),
      mov('m3', 'l2', 2, null, 'e1', '2026-11-24T12:00:00Z'),
    ])
    expect(await screen.findByLabelText('Fecha')).toHaveValue('2026-11-24')
    const listo = seccion('Listo hoy')
    expect(within(listo).getByText('Imprenta Sur')).toBeInTheDocument()
    expect(within(listo).getByText(/Libro/)).toBeInTheDocument()
    expect(within(listo).getByText('10:15')).toBeInTheDocument()
    expect(within(seccion('Por entregar')).getByText('Libro')).toBeInTheDocument()
    expect(within(seccion('En producción')).getByText('No hay trabajos en producción.')).toBeInTheDocument()
    expect(within(seccion('Recién recibido')).getByText(/Cuaderno/)).toBeInTheDocument()
    expect(screen.queryByText(/sin clasificar/i)).not.toBeInTheDocument()
  })

  it('cambiar la fecha recalcula el reporte', async () => {
    montar([
      mov('m1', 'l1', 3, null, 'e1', '2026-11-20T12:00:00Z'),
      mov('m2', 'l1', 3, 'e1', 'e3', '2026-11-24T13:15:00Z'),
    ])
    await screen.findAllByText('10:15')
    const fecha = screen.getByLabelText('Fecha')
    fireEvent.change(fecha, { target: { value: '2026-11-23' } })
    expect(await within(seccion('Listo')).findByText('Nadie quedó listo ese día.')).toBeInTheDocument()
    expect(within(seccion('En producción')).getByText('No hay trabajos en producción.')).toBeInTheDocument()
  })

  it('con la pantalla abierta de un día para otro, al volver muestra el día nuevo ("Listo hoy" sigue siendo hoy)', async () => {
    montar([])
    expect(await screen.findByLabelText('Fecha')).toHaveValue('2026-11-24')
    vi.setSystemTime(new Date('2026-11-25T11:00:00Z')) // 08:00 del miércoles 25 en Santiago
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    fireEvent(document, new Event('visibilitychange'))
    expect(await screen.findByDisplayValue('2026-11-25')).toBeInTheDocument()
    expect(seccion('Listo hoy')).toBeInTheDocument()
  })

  it('avisa cuando hay líneas sin clasificar', async () => {
    montar([mov('m1', 'l1', 3, null, 'desconocida', '2026-11-24T12:00:00Z')])
    expect(await screen.findByText(/1 línea sin clasificar/)).toBeInTheDocument()
  })

  it('"Imprimir" llama a window.print', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined)
    montar([])
    await userEvent.click(await screen.findByRole('button', { name: 'Imprimir' }))
    expect(print).toHaveBeenCalledTimes(1)
  })
})
