import { describe, it, expect, vi } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Taller from './Taller'
import { crearMemoryRepo } from '../../data/memoryRepo'
import type { Repo } from '../../data/repo'
import type { Etapa, Movimiento, Rol, Trabajo } from '../../dominio/tipos'

const etapas: Etapa[] = [
  { id: 'a1', area: 'afilado', orden: 1, nombre: 'Recibido', esListo: false, esFinal: false },
  { id: 'a2', area: 'afilado', orden: 2, nombre: 'En taller', esListo: false, esFinal: false },
  { id: 'a3', area: 'afilado', orden: 3, nombre: 'Afilado', esListo: false, esFinal: false },
  { id: 'a4', area: 'afilado', orden: 4, nombre: 'Listo', esListo: true, esFinal: false },
  { id: 'a5', area: 'afilado', orden: 5, nombre: 'Entregado', esListo: false, esFinal: true },
  { id: 'b1', area: 'encuadernacion', orden: 1, nombre: 'Recibido', esListo: false, esFinal: false },
  { id: 'b2', area: 'encuadernacion', orden: 2, nombre: 'Terminado', esListo: true, esFinal: false },
]
const trab = (id: string, numero: number, clienteId: string, area: Trabajo['area'], urgente = false, recibidoEn = '2026-11-20T12:00:00Z'): Trabajo => ({
  id, numero, clienteId, area, entrada: 'cliente', salida: 'cliente', recibidoEn, urgente,
})
const mov = (id: string, lineaId: string, cantidad: number, o: string | null, d: string): Movimiento => ({
  id, lineaId, cantidad, etapaOrigenId: o, etapaDestinoId: d, usuarioId: 'u', creadoEn: '2026-11-20T12:00:00Z',
})

function montar(rol: Rol = 'jefe_taller', envolver?: (r: Repo) => Repo) {
  const usuario = { id: 'u', nombre: 'Ana', rol }
  const base = crearMemoryRepo({
    usuario,
    etapas,
    clientes: [
      { id: 'c1', nombre: 'Imprenta Sur', rut: '1-9', recorridoId: null },
      { id: 'c2', nombre: 'Libros del Norte', rut: '2-7', recorridoId: null },
    ],
    trabajos: [trab('t1', 11, 'c1', 'afilado'), trab('t2', 12, 'c2', 'encuadernacion'), trab('t3', 13, 'c2', 'afilado', true, '2026-11-22T12:00:00Z')],
    lineas: [
      { id: 'l1', trabajoId: 't1', producto: 'Cuchillo', cantidad: 6 },
      { id: 'l2', trabajoId: 't2', producto: 'Libro', cantidad: 3 },
      { id: 'l3', trabajoId: 't3', producto: 'Tijera', cantidad: 2 },
    ],
    movimientos: [
      mov('m1', 'l1', 6, null, 'a1'), mov('m2', 'l1', 6, 'a1', 'a2'),
      mov('m3', 'l2', 3, null, 'b1'),
      mov('m4', 'l3', 2, null, 'a1'),
    ],
  })
  const repo = envolver ? envolver(base) : base
  render(<Taller repo={repo} usuario={usuario} />)
  return repo
}

const espiar = (espia: (...a: unknown[]) => unknown) => (r: Repo): Repo => ({
  ...r,
  moverUnidades: (...a: Parameters<Repo['moverUnidades']>) => (espia(...a), r.moverUnidades(...a)),
})

const tarjeta = async (cliente: string, producto: string) => {
  const items = await screen.findAllByRole('listitem')
  return items.find((li) => within(li).queryByText(cliente) && within(li).queryByText(new RegExp('^' + producto + ' ·')))!
}
const abrir = async (cliente: string, producto: string) => {
  const fila = await tarjeta(cliente, producto)
  await userEvent.click(within(fila).getByRole('button', { name: new RegExp(cliente) }))
  return fila
}

describe('Taller', () => {
  it('mueve 4 de 6 unidades de En taller a Afilado', async () => {
    const espia = vi.fn()
    montar('operario_afilado', espiar(espia))
    const fila = await abrir('Imprenta Sur', 'Cuchillo')
    // por defecto: siguiente etapa y todas las unidades
    expect(within(fila).getByLabelText('Afilado')).toBeChecked()
    expect(within(fila).getByLabelText('Cantidad')).toHaveValue('6')
    await userEvent.click(within(fila).getByRole('button', { name: 'Menos' }))
    await userEvent.click(within(fila).getByRole('button', { name: 'Menos' }))
    await userEvent.click(within(fila).getByRole('button', { name: 'Mover' }))
    expect(espia).toHaveBeenCalledWith('l1', 4, 'a2', 'a3')
    expect(await screen.findByRole('status')).toHaveTextContent('4 unidades pasaron a Afilado')
    await waitFor(async () => expect(await tarjeta('Imprenta Sur', 'Cuchillo')).toHaveTextContent('En taller 2'))
    expect(await tarjeta('Imprenta Sur', 'Cuchillo')).toHaveTextContent('Afilado 4')
  })

  it('pedir 7 muestra el error y no llama al repo', async () => {
    const espia = vi.fn()
    montar('jefe_taller', espiar(espia))
    const fila = await abrir('Imprenta Sur', 'Cuchillo')
    const cant = within(fila).getByLabelText('Cantidad')
    await userEvent.clear(cant)
    await userEvent.type(cant, '7')
    await userEvent.click(within(fila).getByRole('button', { name: 'Mover' }))
    expect(await within(fila).findByRole('alert')).toHaveTextContent('Solo hay 6 unidades en esta etapa; no se pueden mover 7.')
    expect(espia).not.toHaveBeenCalled()
  })

  it('el operario de afilado no ve líneas de encuadernación', async () => {
    montar('operario_afilado')
    await tarjeta('Imprenta Sur', 'Cuchillo')
    expect(screen.queryByText(/^Libro · 3$/)).not.toBeInTheDocument()
  })

  it('el jefe ve ambas áreas y puede filtrar', async () => {
    montar('jefe_taller')
    await tarjeta('Libros del Norte', 'Libro')
    await userEvent.click(screen.getByRole('button', { name: 'Encuadernación' }))
    expect(screen.queryByText(/^Cuchillo · 6$/)).not.toBeInTheDocument()
    expect(screen.getByText(/^Libro · 3$/)).toBeInTheDocument()
  })

  it('el operario de encuadernación solo ve encuadernación', async () => {
    montar('operario_encuadernacion')
    await tarjeta('Libros del Norte', 'Libro')
    expect(screen.queryByText(/^Cuchillo · 6$/)).not.toBeInTheDocument()
  })

  it('lista urgentes primero', async () => {
    montar('operario_afilado')
    await screen.findAllByRole('listitem')
    const items = screen.getAllByRole('listitem').map((li) => li.textContent ?? '')
    expect(items[0]).toContain('Tijera')
    expect(items[1]).toContain('Cuchillo')
  })

  it('dos toques seguidos en Mover producen una sola llamada', async () => {
    const espia = vi.fn()
    montar('jefe_taller', (r) => ({
      ...r,
      moverUnidades: (...a) => (espia(...a), new Promise((res) => setTimeout(() => res(r.moverUnidades(...a)), 20))),
    }))
    const fila = await abrir('Imprenta Sur', 'Cuchillo')
    await userEvent.dblClick(within(fila).getByRole('button', { name: 'Mover' }))
    expect(espia).toHaveBeenCalledTimes(1)
    await screen.findByRole('status')
  })

  it('un error técnico se muestra en español', async () => {
    montar('jefe_taller', (r) => ({ ...r, moverUnidades: () => Promise.reject(new Error('fetch failed')) }))
    const fila = await abrir('Imprenta Sur', 'Cuchillo')
    await userEvent.click(within(fila).getByRole('button', { name: 'Mover' }))
    const alerta = await within(fila).findByRole('alert')
    expect(alerta).toHaveTextContent('No se pudo mover')
    expect(alerta).not.toHaveTextContent('fetch failed')
  })

  it('permite mover a la etapa final', async () => {
    const espia = vi.fn()
    montar('jefe_taller', espiar(espia))
    const fila = await abrir('Imprenta Sur', 'Cuchillo')
    await userEvent.click(within(fila).getByLabelText('Entregado'))
    await userEvent.click(within(fila).getByRole('button', { name: 'Mover' }))
    expect(espia).toHaveBeenCalledWith('l1', 6, 'a2', 'a5')
    await screen.findByRole('status')
  })

  it('un rol sin acceso no ve líneas', () => {
    montar('chofer')
    expect(screen.getByRole('alert')).toHaveTextContent('No tienes acceso al taller')
  })
})
