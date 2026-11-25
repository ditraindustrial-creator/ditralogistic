import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Entrega from './Entrega'
import { crearMemoryRepo } from '../../data/memoryRepo'
import type { Repo } from '../../data/repo'
import { ErrorEntrega, type LineaEntregable } from '../../dominio/entrega'
import type { Etapa, Movimiento, Trabajo } from '../../dominio/tipos'

const etapas: Etapa[] = [
  { id: 'a1', area: 'afilado', orden: 1, nombre: 'Recibido', esListo: false, esFinal: false },
  { id: 'a4', area: 'afilado', orden: 4, nombre: 'Listo', esListo: true, esFinal: false },
  { id: 'a5', area: 'afilado', orden: 5, nombre: 'Entregado', esListo: false, esFinal: true },
]
const trab = (id: string, numero: number): Trabajo => ({
  id, numero, clienteId: 'c1', area: 'afilado', entrada: 'cliente', salida: 'ruta_propia', recibidoEn: '2026-11-20T12:00:00Z', urgente: false,
})
const mov = (id: string, lineaId: string, cantidad: number, o: string | null, d: string): Movimiento => ({
  id, lineaId, cantidad, etapaOrigenId: o, etapaDestinoId: d, usuarioId: 'u', creadoEn: '2026-11-20T12:00:00Z',
})
const lineas: LineaEntregable[] = [
  { lineaId: 'l1', trabajoId: 't1', numero: 11, producto: 'Cuchillo', listas: 4 },
  { lineaId: 'l2', trabajoId: 't1', numero: 11, producto: 'Tijera', listas: 2 },
]

function montar(envolver?: (r: Repo) => Repo, props: Partial<Parameters<typeof Entrega>[0]> = {}) {
  const base = crearMemoryRepo({
    usuario: { id: 'u1', nombre: 'Pedro', rol: 'chofer' },
    etapas,
    clientes: [{ id: 'c1', nombre: 'Imprenta Sur', rut: '1-9', recorridoId: null }],
    trabajos: [trab('t1', 11)],
    lineas: [
      { id: 'l1', trabajoId: 't1', producto: 'Cuchillo', cantidad: 4 },
      { id: 'l2', trabajoId: 't1', producto: 'Tijera', cantidad: 2 },
    ],
    movimientos: [mov('m1', 'l1', 4, null, 'a4'), mov('m2', 'l2', 2, null, 'a4')],
  })
  const repo = envolver ? envolver(base) : base
  const alCerrar = vi.fn()
  render(<Entrega repo={repo} lineas={lineas} alCerrar={alCerrar} {...props} />)
  return { repo, alCerrar }
}
const espiar = (espia: (...a: unknown[]) => unknown) => (r: Repo): Repo => ({
  ...r,
  entregarUnidades: (...a: Parameters<Repo['entregarUnidades']>) => (espia(...a), r.entregarUnidades(...a)),
})
const doc = () => screen.getByLabelText(/N° de documento/)
const entregar = () => screen.getByRole('button', { name: 'Entregar' })

describe('Entrega', () => {
  it('al abrirse se muestra en pantalla y deja el cursor en el número de documento', () => {
    const original = Element.prototype.scrollIntoView
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    try {
      montar()
      expect(scroll).toHaveBeenCalledWith({ block: 'start' })
      expect(doc()).toHaveFocus()
    } finally {
      Element.prototype.scrollIntoView = original
    }
  })

  it('sin scrollIntoView (jsdom) igual enfoca el documento', () => {
    montar()
    expect(doc()).toHaveFocus()
  })

  it('por defecto entrega todo lo listo de cada línea', () => {
    montar()
    expect(screen.getByLabelText('Cantidad Cuchillo')).toHaveValue('4')
    expect(screen.getByLabelText('Cantidad Tijera')).toHaveValue('2')
    expect(screen.getByLabelText('Incluir Cuchillo')).toBeChecked()
    expect(screen.getByText('Trabajo N.º 11')).toBeInTheDocument()
  })

  it('entrega 3 de 4 con el documento 4521: una llamada, mensaje en español y el resto queda pendiente', async () => {
    const espia = vi.fn()
    const alTerminar = vi.fn()
    montar(espiar(espia), { alTerminar })
    await userEvent.click(screen.getByLabelText('Incluir Tijera')) // solo el cuchillo
    await userEvent.click(screen.getByRole('button', { name: 'Menos Cuchillo' }))
    await userEvent.type(doc(), ' 4521 ')
    await userEvent.click(entregar())
    expect(await screen.findByRole('status')).toHaveTextContent('Entrega registrada: 3 unidades · Documento 4521')
    expect(espia).toHaveBeenCalledTimes(1)
    expect(espia).toHaveBeenCalledWith([{ lineaId: 'l1', cantidad: 3 }], '4521', { clave: expect.any(String) })
    expect(alTerminar).toHaveBeenCalledTimes(1)
  })

  it('una sola unidad va en singular', async () => {
    montar()
    await userEvent.click(screen.getByLabelText('Incluir Cuchillo'))
    await userEvent.click(screen.getByRole('button', { name: 'Menos Tijera' }))
    await userEvent.type(doc(), 'F-77')
    await userEvent.click(entregar())
    expect(await screen.findByRole('status')).toHaveTextContent('Entrega registrada: 1 unidad · Documento F-77')
  })

  it('el contador no pasa de lo listo ni baja de 1, y lo escrito se recorta al máximo', async () => {
    montar()
    const mas = screen.getByRole('button', { name: 'Más Tijera' })
    const menos = screen.getByRole('button', { name: 'Menos Tijera' })
    expect(mas).toBeDisabled()
    await userEvent.click(menos)
    await userEvent.click(menos)
    expect(screen.getByLabelText('Cantidad Tijera')).toHaveValue('1')
    expect(menos).toBeDisabled()
    const cant = screen.getByLabelText('Cantidad Cuchillo')
    await userEvent.clear(cant)
    await userEvent.type(cant, '9')
    expect(cant).toHaveValue('4')
    await userEvent.click(screen.getByRole('button', { name: 'Todo Tijera' }))
    expect(screen.getByLabelText('Cantidad Tijera')).toHaveValue('2')
  })

  it('el documento es obligatorio y se valida con las reglas de la base, sin llamar al repo', async () => {
    const espia = vi.fn()
    montar(espiar(espia))
    await userEvent.click(entregar())
    expect(await screen.findByRole('alert')).toHaveTextContent('Anota el número de guía o factura.')
    await userEvent.type(doc(), '45,21')
    await userEvent.click(entregar())
    expect(await screen.findByRole('alert')).toHaveTextContent('El número de documento no puede llevar comas.')
    await userEvent.clear(doc())
    await userEvent.type(doc(), 'x'.repeat(41))
    await userEvent.click(entregar())
    expect(await screen.findByRole('alert')).toHaveTextContent('hasta 40 caracteres')
    expect(espia).not.toHaveBeenCalled()
  })

  it('sin ninguna línea marcada pide indicar qué entregar', async () => {
    const espia = vi.fn()
    montar(espiar(espia))
    await userEvent.click(screen.getByLabelText('Incluir Cuchillo'))
    await userEvent.click(screen.getByLabelText('Incluir Tijera'))
    await userEvent.type(doc(), '1')
    await userEvent.click(entregar())
    expect(await screen.findByRole('alert')).toHaveTextContent('Indica qué entregar.')
    expect(espia).not.toHaveBeenCalled()
  })

  it('una cantidad vacía no se envía', async () => {
    const espia = vi.fn()
    montar(espiar(espia))
    await userEvent.clear(screen.getByLabelText('Cantidad Cuchillo'))
    await userEvent.type(doc(), '1')
    await userEvent.click(entregar())
    expect(await screen.findByRole('alert')).toHaveTextContent('La cantidad a entregar debe ser un número entero mayor que cero.')
    expect(espia).not.toHaveBeenCalled()
  })

  it('un rechazo del servidor se muestra en español y se puede reintentar', async () => {
    let falla = true
    montar((r) => ({
      ...r,
      entregarUnidades: (...a) =>
        falla ? ((falla = false), Promise.reject(new ErrorEntrega('«Tijera» tiene 1 unidad lista; no se pueden entregar 2 (faltan 1).'))) : r.entregarUnidades(...a),
    }))
    await userEvent.type(doc(), '4521')
    await userEvent.click(entregar())
    expect(await screen.findByRole('alert')).toHaveTextContent('«Tijera» tiene 1 unidad lista; no se pueden entregar 2 (faltan 1).')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    await userEvent.click(entregar())
    expect(await screen.findByRole('status')).toHaveTextContent('Entrega registrada: 6 unidades · Documento 4521')
  })

  it('respuesta perdida: la entrega sí quedó, el reintento reusa la clave y no entrega dos veces', async () => {
    const claves: unknown[] = []
    let perder = true
    const { repo } = montar((r) => ({
      ...r,
      entregarUnidades: async (...a) => {
        claves.push(a[2]?.clave)
        await r.entregarUnidades(...a)
        if (perder) {
          perder = false
          throw new Error('Failed to fetch') // la base registró la entrega, pero la respuesta no llegó
        }
      },
    }))
    await userEvent.type(doc(), '4521')
    await userEvent.click(entregar())
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo registrar la entrega. Revisa tu conexión e inténtalo de nuevo.')
    await userEvent.click(entregar())
    expect(await screen.findByRole('status')).toHaveTextContent('Entrega registrada: 6 unidades · Documento 4521')
    expect(claves).toHaveLength(2)
    expect(claves[0]).toMatch(/^[0-9a-f-]{36}$/)
    expect(claves[1]).toBe(claves[0])
    const d = await repo.cargarTodo()
    expect(d.movimientos.filter((m) => m.etapaDestinoId === 'a5').reduce((s, m) => s + m.cantidad, 0)).toBe(6)
    expect(d.trabajos[0].guiaDespacho).toBe('4521')
  })

  it('cada panel abierto tiene su propia clave', async () => {
    const claves: unknown[] = []
    const env = (r: Repo): Repo => ({ ...r, entregarUnidades: (...a) => (claves.push(a[2]?.clave), r.entregarUnidades(...a)) })
    const { unmount } = render(<Entrega repo={env(crearMemoryRepo({ usuario: { id: 'u', nombre: 'P', rol: 'chofer' } }))} lineas={lineas} alCerrar={() => undefined} />)
    await userEvent.type(doc(), '1')
    await userEvent.click(entregar())
    await screen.findByRole('alert')
    unmount()
    render(<Entrega repo={env(crearMemoryRepo({ usuario: { id: 'u', nombre: 'P', rol: 'chofer' } }))} lineas={lineas} alCerrar={() => undefined} />)
    await userEvent.type(doc(), '1')
    await userEvent.click(entregar())
    await screen.findByRole('alert')
    expect(claves[1]).not.toBe(claves[0])
  })

  it('encomienda: anota el transporte (opcional) junto con el documento', async () => {
    const espia = vi.fn()
    const { repo } = montar(espiar(espia), { conTransporte: true })
    await userEvent.type(doc(), '4521')
    await userEvent.type(screen.getByLabelText(/Transporte \(empresa y N° de guía de transporte/), ' Starken 998877 ')
    await userEvent.click(entregar())
    expect(await screen.findByRole('status')).toHaveTextContent('Entrega registrada: 6 unidades · Documento 4521 · Transporte Starken 998877')
    expect(espia).toHaveBeenCalledWith(expect.any(Array), '4521', { clave: expect.any(String), transporte: 'Starken 998877' })
    expect((await repo.cargarTodo()).trabajos[0].transporte).toBe('Starken 998877')
  })

  it('sin conTransporte no pide transporte', () => {
    montar()
    expect(screen.queryByLabelText(/Transporte/)).not.toBeInTheDocument()
  })

  it('un error técnico nunca se muestra crudo', async () => {
    montar((r) => ({ ...r, entregarUnidades: () => Promise.reject(new Error('Failed to fetch')) }))
    await userEvent.type(doc(), '4521')
    await userEvent.click(entregar())
    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent('No se pudo registrar la entrega. Revisa tu conexión e inténtalo de nuevo.')
    expect(alerta).not.toHaveTextContent('Failed to fetch')
  })

  it('dos toques seguidos en Entregar producen una sola llamada', async () => {
    const espia = vi.fn()
    montar((r) => ({
      ...r,
      entregarUnidades: (...a) => (espia(...a), new Promise((res) => setTimeout(() => res(r.entregarUnidades(...a)), 20))),
    }))
    await userEvent.type(doc(), '4521')
    await userEvent.dblClick(entregar())
    expect(espia).toHaveBeenCalledTimes(1)
    await screen.findByRole('status')
  })

  it('tras entregar muestra la confirmación y Listo cierra el panel', async () => {
    const { alCerrar } = montar()
    await userEvent.type(doc(), '4521')
    await userEvent.click(entregar())
    expect(await screen.findByRole('status')).toHaveTextContent('Entrega registrada: 6 unidades · Documento 4521')
    await userEvent.click(screen.getByRole('button', { name: 'Listo' }))
    expect(alCerrar).toHaveBeenCalledTimes(1)
  })

  it('sin unidades listas avisa y no ofrece entregar', () => {
    montar(undefined, { lineas: [] })
    expect(screen.getByText('No hay unidades listas para entregar.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Entregar' })).not.toBeInTheDocument()
  })

  it('si otro celular entrega parte mientras tanto, el tope baja y la cantidad se ajusta', async () => {
    const { rerender } = (() => {
      const base = crearMemoryRepo({ usuario: { id: 'u1', nombre: 'Pedro', rol: 'chofer' }, etapas })
      const r = render(<Entrega repo={base} lineas={lineas} alCerrar={() => undefined} />)
      return { rerender: (l: LineaEntregable[]) => r.rerender(<Entrega repo={base} lineas={l} alCerrar={() => undefined} />) }
    })()
    expect(screen.getByLabelText('Cantidad Cuchillo')).toHaveValue('4')
    rerender([{ ...lineas[0], listas: 1 }, lineas[1]])
    expect(screen.getByLabelText('Cantidad Cuchillo')).toHaveValue('1')
    expect(screen.getByRole('button', { name: 'Más Cuchillo' })).toBeDisabled()
  })
})
