import { describe, it, expect, vi } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Taller from './Taller'
import { crearMemoryRepo } from '../../data/memoryRepo'
import type { Repo } from '../../data/repo'
import { ErrorEntrega } from '../../dominio/entrega'
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
    trabajos: [trab('t1', 11, 'c1', 'afilado'), trab('t2', 12, 'c2', 'encuadernacion'), trab('t3', 13, 'c2', 'afilado', true, '2026-11-22T12:00:00Z'), trab('t4', 14, 'c1', 'afilado', false, '2026-11-23T12:00:00Z'), trab('t5', 15, 'c2', 'afilado', false, '2026-11-24T12:00:00Z')],
    lineas: [
      { id: 'l1', trabajoId: 't1', producto: 'Cuchillo', cantidad: 6 },
      { id: 'l2', trabajoId: 't2', producto: 'Libro', cantidad: 3 },
      { id: 'l3', trabajoId: 't3', producto: 'Tijera', cantidad: 2 },
      { id: 'l4', trabajoId: 't4', producto: 'Sierra', cantidad: 6 },
      { id: 'l5', trabajoId: 't5', producto: 'Hacha', cantidad: 5 },
    ],
    movimientos: [
      mov('m1', 'l1', 6, null, 'a1'), mov('m2', 'l1', 6, 'a1', 'a2'),
      mov('m3', 'l2', 3, null, 'b1'),
      mov('m4', 'l3', 2, null, 'a1'),
      mov('m5', 'l4', 6, null, 'a1'), mov('m6', 'l4', 6, 'a1', 'a2'), mov('m7', 'l4', 4, 'a2', 'a3'),
      mov('m8', 'l5', 5, null, 'a1'), mov('m9', 'l5', 5, 'a1', 'a4'),
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
const espiarEntrega = (espia: (...a: unknown[]) => unknown, mover: (...a: unknown[]) => unknown = () => undefined) => (r: Repo): Repo => ({
  ...r,
  moverUnidades: (...a: Parameters<Repo['moverUnidades']>) => (mover(...a), r.moverUnidades(...a)),
  entregarUnidades: (...a: Parameters<Repo['entregarUnidades']>) => (espia(...a), r.entregarUnidades(...a)),
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

  describe('quién puede entregar', () => {
    it('un operario no recibe la etapa final como destino y ve el aviso', async () => {
      montar('operario_afilado')
      const fila = await abrir('Libros del Norte', 'Hacha')
      expect(within(fila).queryByLabelText('Entregado')).not.toBeInTheDocument()
      expect(within(fila).getByText('Solo secretaría, jefe de taller o chofer registran entregas.')).toBeInTheDocument()
      expect(within(fila).getByRole('button', { name: 'Mover' })).toBeInTheDocument()
    })
    it('el jefe de taller sí la tiene', async () => {
      montar('jefe_taller')
      const fila = await abrir('Libros del Norte', 'Hacha')
      expect(within(fila).getByLabelText('Entregado')).toBeInTheDocument()
      expect(within(fila).queryByText(/registran entregas/)).not.toBeInTheDocument()
    })
  })

  describe('mover a la etapa final es una entrega (pide documento y usa entregarUnidades)', () => {
    it('si el origen no es "Listo", avisa y no llama a nada', async () => {
      const mover = vi.fn()
      const entregar = vi.fn()
      montar('jefe_taller', espiarEntrega(entregar, mover))
      const fila = await abrir('Imprenta Sur', 'Cuchillo')
      await userEvent.click(within(fila).getByLabelText('Entregado'))
      await userEvent.click(within(fila).getByRole('button', { name: 'Entregar…' }))
      expect(await within(fila).findByRole('alert')).toHaveTextContent('Primero pasa las unidades a Listo.')
      expect(mover).not.toHaveBeenCalled()
      expect(entregar).not.toHaveBeenCalled()
      expect(screen.queryByLabelText(/N° de documento/)).not.toBeInTheDocument()
    })

    it('desde "Listo" abre la entrega, exige el documento y entrega con una sola llamada (sin moverUnidades)', async () => {
      const mover = vi.fn()
      const entregar = vi.fn()
      montar('jefe_taller', espiarEntrega(entregar, mover))
      const fila = await abrir('Libros del Norte', 'Hacha')
      await userEvent.click(within(fila).getByLabelText('Entregado'))
      await userEvent.click(within(fila).getByRole('button', { name: 'Entregar…' }))
      await userEvent.click(await screen.findByRole('button', { name: 'Entregar' }))
      expect(await screen.findByRole('alert')).toHaveTextContent('Anota el número de guía o factura.')
      await userEvent.click(screen.getByRole('button', { name: 'Menos Hacha' }))
      await userEvent.type(screen.getByLabelText(/N° de documento/), '4521')
      await userEvent.click(screen.getByRole('button', { name: 'Entregar' }))
      expect(await screen.findByRole('status')).toHaveTextContent('Entrega registrada: 4 unidades · Documento 4521')
      expect(entregar).toHaveBeenCalledTimes(1)
      expect(entregar).toHaveBeenCalledWith([{ lineaId: 'l5', cantidad: 4 }], '4521')
      expect(mover).not.toHaveBeenCalled()
      await waitFor(async () => expect(await tarjeta('Libros del Norte', 'Hacha')).toHaveTextContent('Listo 1'))
    })

    it('un rechazo del servidor se muestra en español dentro de la entrega', async () => {
      montar('jefe_taller', (r) => ({
        ...r,
        entregarUnidades: () => Promise.reject(new ErrorEntrega('«Hacha» tiene 1 unidad lista; no se pueden entregar 5 (faltan 4).')),
      }))
      const fila = await abrir('Libros del Norte', 'Hacha')
      await userEvent.click(within(fila).getByLabelText('Entregado'))
      await userEvent.click(within(fila).getByRole('button', { name: 'Entregar…' }))
      await userEvent.type(await screen.findByLabelText(/N° de documento/), '1')
      await userEvent.click(screen.getByRole('button', { name: 'Entregar' }))
      expect(await screen.findByRole('alert')).toHaveTextContent('«Hacha» tiene 1 unidad lista; no se pueden entregar 5 (faltan 4).')
    })

    it('mover a una etapa que no es final sigue usando moverUnidades', async () => {
      const mover = vi.fn()
      const entregar = vi.fn()
      montar('jefe_taller', espiarEntrega(entregar, mover))
      const fila = await abrir('Imprenta Sur', 'Cuchillo')
      await userEvent.click(within(fila).getByRole('button', { name: 'Mover' }))
      expect(mover).toHaveBeenCalledWith('l1', 6, 'a2', 'a3')
      expect(entregar).not.toHaveBeenCalled()
      await screen.findByRole('status')
    })
  })

  it('un rol sin acceso no ve líneas', () => {
    montar('chofer')
    expect(screen.getByRole('alert')).toHaveTextContent('No tienes acceso al taller')
  })

  describe('línea con unidades en varias etapas (2 En taller, 4 Afilado)', () => {
    const cant = (fila: HTMLElement) => within(fila).getByLabelText('Cantidad')
    const boton = (fila: HTMLElement, n: string) => within(fila).getByRole('button', { name: n })

    it('muestra "Desde", elige el origen por defecto y recalcula destino y cantidad al cambiarlo', async () => {
      montar('jefe_taller')
      const fila = await abrir('Imprenta Sur', 'Sierra')
      expect(within(fila).getByLabelText('En taller (2)')).toBeChecked()
      expect(within(fila).getByLabelText('Afilado (4)')).not.toBeChecked()
      expect(within(fila).getByLabelText('Afilado', { selector: 'input[name^="destino"]' })).toBeChecked()
      expect(cant(fila)).toHaveValue('2')
      await userEvent.click(within(fila).getByLabelText('Afilado (4)'))
      expect(within(fila).getByLabelText('Listo')).toBeChecked()
      expect(cant(fila)).toHaveValue('4')
      expect(within(fila).getByText('Disponibles en esta etapa: 4')).toBeInTheDocument()
    })

    it('el contador no pasa del máximo ni baja de 1, y "Todas" vuelve al máximo', async () => {
      montar('jefe_taller')
      const fila = await abrir('Imprenta Sur', 'Sierra')
      await userEvent.click(boton(fila, 'Más'))
      expect(cant(fila)).toHaveValue('2')
      await userEvent.click(boton(fila, 'Menos'))
      await userEvent.click(boton(fila, 'Menos'))
      expect(cant(fila)).toHaveValue('1')
      await userEvent.click(boton(fila, 'Todas'))
      expect(cant(fila)).toHaveValue('2')
    })

    it('confirma en singular y en plural', async () => {
      const espia = vi.fn()
      montar('jefe_taller', espiar(espia))
      const fila = await abrir('Imprenta Sur', 'Sierra')
      await userEvent.click(boton(fila, 'Menos'))
      await userEvent.click(boton(fila, 'Mover'))
      expect(await screen.findByRole('status')).toHaveTextContent('1 unidad pasó a Afilado')
      expect(espia).toHaveBeenCalledWith('l4', 1, 'a2', 'a3')
      const otra = await abrir('Imprenta Sur', 'Sierra')
      await userEvent.click(within(otra).getByLabelText('Afilado (5)'))
      await userEvent.click(within(otra).getByRole('button', { name: 'Mover' }))
      expect(await screen.findByRole('status')).toHaveTextContent('5 unidades pasaron a Listo')
    })

    it('permite mover hacia atrás', async () => {
      const espia = vi.fn()
      montar('jefe_taller', espiar(espia))
      const fila = await abrir('Imprenta Sur', 'Sierra')
      await userEvent.click(within(fila).getByLabelText('Afilado (4)'))
      await userEvent.click(within(fila).getByLabelText('En taller', { selector: 'input[name^="destino"]' }))
      await userEvent.click(boton(fila, 'Mover'))
      expect(espia).toHaveBeenCalledWith('l4', 4, 'a3', 'a2')
      await screen.findByRole('status')
    })

    it('si otro celular vacía el origen elegido, la selección pasa al origen vigente', async () => {
      const repo = montar('jefe_taller')
      const fila = await abrir('Imprenta Sur', 'Sierra')
      await userEvent.click(boton(fila, 'Menos'))
      await repo.moverUnidades('l4', 2, 'a2', 'a3') // otro dispositivo
      await waitFor(() => expect(screen.getByText('Disponibles en esta etapa: 6')).toBeInTheDocument())
      const actual = await tarjeta('Imprenta Sur', 'Sierra')
      expect(within(actual).queryByText('Desde')).not.toBeInTheDocument() // ya hay una sola etapa de origen
      expect(cant(actual)).toHaveValue('6')
      expect(within(actual).getByLabelText('Listo')).toBeChecked()
    })

    it('si el origen tiene menos unidades que la cantidad, la baja al máximo', async () => {
      const repo = montar('jefe_taller')
      const fila = await abrir('Imprenta Sur', 'Sierra')
      await repo.moverUnidades('l4', 1, 'a2', 'a3')
      await waitFor(() => expect(cant(fila)).toHaveValue('1'))
    })

    it('si la línea desaparece, cierra el panel', async () => {
      const repo = montar('jefe_taller')
      await abrir('Imprenta Sur', 'Sierra')
      await repo.moverUnidades('l4', 2, 'a2', 'a5')
      await repo.moverUnidades('l4', 4, 'a3', 'a5')
      await waitFor(() => expect(screen.queryByText(/^Sierra · 6$/)).not.toBeInTheDocument())
      expect(screen.queryByLabelText('Cantidad')).not.toBeInTheDocument()
    })
  })
})
