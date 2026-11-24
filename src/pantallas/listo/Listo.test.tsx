import { describe, it, expect, vi } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Listo from './Listo'
import { crearMemoryRepo, type RepoMemoria } from '../../data/memoryRepo'
import type { Repo } from '../../data/repo'
import type { Etapa, Linea, Movimiento, Trabajo } from '../../dominio/tipos'

const etapas: Etapa[] = [
  { id: 'a1', area: 'afilado', orden: 1, nombre: 'Recibido', esListo: false, esFinal: false },
  { id: 'a2', area: 'afilado', orden: 2, nombre: 'Listo', esListo: true, esFinal: false },
  { id: 'b1', area: 'encuadernacion', orden: 1, nombre: 'Recibido', esListo: false, esFinal: false },
  { id: 'b2', area: 'encuadernacion', orden: 2, nombre: 'Listo', esListo: true, esFinal: false },
]
const trab = (id: string, numero: number, clienteId: string, area: Trabajo['area']): Trabajo => ({
  id, numero, clienteId, area, entrada: 'cliente', salida: 'cliente', recibidoEn: '2026-11-20T12:00:00Z', urgente: false,
})
const lin = (id: string, trabajoId: string, cantidad: number): Linea => ({ id, trabajoId, producto: 'X', cantidad })
const mov = (id: string, lineaId: string, cantidad: number, o: string | null, d: string, creadoEn: string): Movimiento => ({
  id, lineaId, cantidad, etapaOrigenId: o, etapaDestinoId: d, usuarioId: 'u', creadoEn,
})

function montar(extra?: (r: RepoMemoria) => RepoMemoria) {
  const base = crearMemoryRepo({
    usuario: { id: 'u', nombre: 'Ana', rol: 'admin' },
    etapas,
    clientes: [
      { id: 'c1', nombre: 'Imprenta Sur', rut: '1-9', recorridoId: 'r1' },
      { id: 'c2', nombre: 'Libros del Norte', rut: '2-7', recorridoId: 'r2' },
      { id: 'c3', nombre: 'Taller Sin Ruta', rut: '3-5', recorridoId: null },
    ],
    recorridos: [
      { id: 'r1', nombre: 'Costa', dia: 2, camioneta: 'C1', lejano: false },
      { id: 'r2', nombre: 'Cordillera', dia: 4, camioneta: 'C2', lejano: true },
    ],
    trabajos: [trab('t1', 11, 'c1', 'afilado'), trab('t2', 12, 'c2', 'encuadernacion'), trab('t3', 13, 'c3', 'afilado')],
    lineas: [lin('l1', 't1', 6), lin('l2', 't2', 3), lin('l3', 't3', 2)],
    movimientos: [
      mov('m1', 'l1', 6, null, 'a1', '2026-11-20T12:00:00Z'),
      mov('m2', 'l1', 4, 'a1', 'a2', '2026-11-24T13:30:00Z'), // 10:30 en Chile (UTC-3)
      mov('m3', 'l2', 3, null, 'b1', '2026-11-20T12:00:00Z'),
      mov('m4', 'l3', 2, null, 'a1', '2026-11-20T12:00:00Z'),
      mov('m5', 'l3', 2, 'a1', 'a2', '2026-11-24T14:00:00Z'),
    ],
  })
  const repo = extra ? extra(base) : base
  render(<Listo repo={repo} />)
  return repo
}

/** Las tarjetas (li) visibles; el nombre del cliente también aparece como opción del filtro. */
const tarjetas = () => screen.queryAllByRole('listitem')
const tarjeta = async (nombre: string) => {
  await screen.findAllByRole('listitem')
  return tarjetas().find((li) => within(li).queryByText(nombre))!
}
const hay = (nombre: string) => tarjetas().some((li) => within(li).queryByText(nombre))

describe('Listo', () => {
  it('muestra "4 de 6 listas" con la hora de Chile, el recorrido y el día; y agrupa los sin recorrido', async () => {
    montar()
    const fila = await tarjeta('Imprenta Sur')
    expect(within(fila).getByText('4 de 6 listas')).toBeInTheDocument()
    expect(within(fila).getByText(/Listo desde .*10:30/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Costa · Martes' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Cordillera · Jueves' })).toBeInTheDocument()
    const sin = screen.getByRole('heading', { name: 'Sin recorrido' })
    expect(within(sin.closest('section')!).getByText('Taller Sin Ruta')).toBeInTheDocument()
    const nada = await tarjeta('Libros del Norte')
    expect(within(nada).getByText('0 de 3 listas')).toBeInTheDocument()
    expect(within(nada).getByText('Aún no hay unidades listas')).toBeInTheDocument()
  })

  it('filtra por área', async () => {
    montar()
    await tarjeta('Imprenta Sur')
    await userEvent.selectOptions(screen.getByLabelText('Área'), 'encuadernacion')
    expect(hay('Imprenta Sur')).toBe(false)
    expect(hay('Libros del Norte')).toBe(true)
  })

  it('filtra por cliente', async () => {
    montar()
    await tarjeta('Imprenta Sur')
    await userEvent.selectOptions(screen.getByLabelText('Cliente'), 'c3')
    expect(hay('Taller Sin Ruta')).toBe(true)
    expect(hay('Imprenta Sur')).toBe(false)
  })

  it('filtra por recorrido, incluido "Sin recorrido"', async () => {
    montar()
    await tarjeta('Imprenta Sur')
    await userEvent.selectOptions(screen.getByLabelText('Recorrido'), 'Cordillera')
    expect(hay('Libros del Norte')).toBe(true)
    expect(hay('Imprenta Sur')).toBe(false)
    await userEvent.selectOptions(screen.getByLabelText('Recorrido'), '__sin_recorrido__')
    expect(hay('Taller Sin Ruta')).toBe(true)
    expect(hay('Libros del Norte')).toBe(false)
  })

  it('filtra por día', async () => {
    montar()
    await tarjeta('Imprenta Sur')
    await userEvent.selectOptions(screen.getByLabelText('Día'), '2')
    expect(hay('Imprenta Sur')).toBe(true)
    expect(hay('Libros del Norte')).toBe(false)
    expect(hay('Taller Sin Ruta')).toBe(false)
  })

  it('"Solo con unidades listas" oculta los trabajos sin nada listo', async () => {
    montar()
    await tarjeta('Libros del Norte')
    await userEvent.click(screen.getByLabelText('Solo con unidades listas'))
    expect(hay('Libros del Norte')).toBe(false)
    expect(hay('Imprenta Sur')).toBe(true)
  })

  it('se actualiza en vivo cuando se agrega un movimiento', async () => {
    const repo = montar()
    const fila = await tarjeta('Libros del Norte')
    expect(within(fila).getByText('0 de 3 listas')).toBeInTheDocument()
    await repo.moverUnidades('l2', 3, 'b1', 'b2')
    expect(await screen.findByText('3 de 3 listas')).toBeInTheDocument()
  })

  it('entrega parcial: 2 entregadas y 4 listas de 6 pedidas -> "4 de 4 listas", Todo listo y "2 entregadas"', async () => {
    const repo = crearMemoryRepo({
      usuario: { id: 'u', nombre: 'Ana', rol: 'admin' }, etapas: [...etapas, { id: 'a3', area: 'afilado', orden: 3, nombre: 'Entregado', esListo: false, esFinal: true }],
      clientes: [{ id: 'c1', nombre: 'Imprenta Sur', rut: '1-9', recorridoId: null }],
      trabajos: [trab('t1', 1, 'c1', 'afilado')], lineas: [lin('l1', 't1', 6)],
      movimientos: [mov('m1', 'l1', 6, null, 'a1', '2026-11-20T12:00:00Z'), mov('m2', 'l1', 6, 'a1', 'a2', '2026-11-21T12:00:00Z'), mov('m3', 'l1', 2, 'a2', 'a3', '2026-11-22T12:00:00Z')],
    })
    render(<Listo repo={repo} />)
    const fila = await tarjeta('Imprenta Sur')
    expect(within(fila).getByText('4 de 4 listas')).toBeInTheDocument()
    expect(within(fila).getByText(/Todo listo desde/)).toBeInTheDocument()
    expect(within(fila).getByText('2 entregadas · 6 en el pedido')).toBeInTheDocument()
  })

  it('entrega parcial: 4 entregadas y 2 en taller -> "0 de 2 listas" y aún no hay listas', async () => {
    const repo = crearMemoryRepo({
      usuario: { id: 'u', nombre: 'Ana', rol: 'admin' }, etapas: [...etapas, { id: 'a3', area: 'afilado', orden: 3, nombre: 'Entregado', esListo: false, esFinal: true }],
      clientes: [{ id: 'c1', nombre: 'Imprenta Sur', rut: '1-9', recorridoId: null }],
      trabajos: [trab('t1', 1, 'c1', 'afilado')], lineas: [lin('l1', 't1', 6)],
      movimientos: [mov('m1', 'l1', 6, null, 'a1', '2026-11-20T12:00:00Z'), mov('m2', 'l1', 4, 'a1', 'a3', '2026-11-22T12:00:00Z')],
    })
    render(<Listo repo={repo} />)
    const fila = await tarjeta('Imprenta Sur')
    expect(within(fila).getByText('0 de 2 listas')).toBeInTheDocument()
    expect(within(fila).getByText('Aún no hay unidades listas')).toBeInTheDocument()
    expect(within(fila).getByText('4 entregadas · 6 en el pedido')).toBeInTheDocument()
  })

  it('una ráfaga de movimientos produce una sola recarga', async () => {
    const base = montar()
    const espiar = vi.spyOn(base, 'cargarTodo')
    await tarjeta('Libros del Norte')
    const antes = espiar.mock.calls.length
    await base.moverUnidades('l2', 1, 'b1', 'b2')
    await base.moverUnidades('l2', 1, 'b1', 'b2')
    await base.moverUnidades('l2', 1, 'b1', 'b2')
    expect(await screen.findByText('3 de 3 listas')).toBeInTheDocument()
    expect(espiar.mock.calls.length - antes).toBe(1)
  })

  it('muestra "Reconectando…" mientras el canal está caído y recarga al volver', async () => {
    const repo = montar()
    await tarjeta('Libros del Norte')
    act(() => repo.simularConexion(false))
    expect(screen.getByText('Reconectando…')).toBeInTheDocument()
    const espiar = vi.spyOn(repo, 'cargarTodo')
    act(() => repo.simularConexion(true))
    expect(screen.queryByText('Reconectando…')).not.toBeInTheDocument()
    await waitFor(() => expect(espiar).toHaveBeenCalledTimes(1))
  })

  it('recarga cuando la pestaña vuelve a estar visible', async () => {
    const repo = montar()
    await tarjeta('Libros del Norte')
    const espiar = vi.spyOn(repo, 'cargarTodo')
    document.dispatchEvent(new Event('visibilitychange'))
    await waitFor(() => expect(espiar).toHaveBeenCalledTimes(1))
  })

  it('al desmontar cancela la suscripción', async () => {
    const cancelar = vi.fn()
    const base = crearMemoryRepo({ etapas })
    const repo: Repo = { ...base, suscribirCambios: () => cancelar }
    const { unmount } = render(<Listo repo={repo} />)
    await screen.findByText(/No hay trabajos/)
    unmount()
    expect(cancelar).toHaveBeenCalledTimes(1)
  })

  it('si falla la carga muestra un aviso en español', async () => {
    const base = crearMemoryRepo({ etapas })
    const repo: Repo = { ...base, cargarTodo: () => Promise.reject(new Error('No se pudo cargar la información. Revisa tu conexión.')) }
    render(<Listo repo={repo} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo cargar la información')
  })
})
