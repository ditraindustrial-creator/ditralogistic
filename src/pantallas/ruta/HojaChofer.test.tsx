import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import HojaChofer from './HojaChofer'
import { crearMemoryRepo } from '../../data/memoryRepo'
import type { Repo } from '../../data/repo'
import { ErrorEntrega } from '../../dominio/entrega'
import type { Etapa, Movimiento, Rol, Trabajo, Visita } from '../../dominio/tipos'

const etapas: Etapa[] = [
  { id: 'a1', area: 'afilado', orden: 1, nombre: 'Recibido', esListo: false, esFinal: false },
  { id: 'a4', area: 'afilado', orden: 4, nombre: 'Listo', esListo: true, esFinal: false },
  { id: 'a5', area: 'afilado', orden: 5, nombre: 'Entregado', esListo: false, esFinal: true },
]
const trab = (id: string, numero: number, clienteId: string, extra: Partial<Trabajo> = {}): Trabajo => ({
  id, numero, clienteId, area: 'afilado', entrada: 'cliente', salida: 'ruta_propia', recibidoEn: '2026-11-20T12:00:00Z', urgente: false, ...extra,
})
const mov = (id: string, lineaId: string, cantidad: number, o: string | null, d: string): Movimiento => ({
  id, lineaId, cantidad, etapaOrigenId: o, etapaDestinoId: d, usuarioId: 'u', creadoEn: '2026-11-20T12:00:00Z',
})

// Hoy: martes 24 de noviembre de 2026, mediodía en Chile.
const HOY = '2026-11-24T15:00:00Z'
const FECHA = '2026-11-24'

function montar(opciones: { rol?: Rol; envolver?: (r: Repo) => Repo; visitas?: Visita[]; dosRecorridos?: boolean; trabajos?: Trabajo[] } = {}) {
  const dos = opciones.dosRecorridos ?? true
  const usuario = { id: 'u1', nombre: 'Pedro', rol: opciones.rol ?? 'chofer' }
  const base = crearMemoryRepo({
    usuario,
    etapas,
    recorridos: [
      { id: 'r1', nombre: 'Sur', dia: 2, camioneta: 'Camioneta A', lejano: false },
      ...(dos ? [{ id: 'r2', nombre: 'Costa', dia: 2 as const, camioneta: 'Camioneta B', lejano: true }] : []),
    ],
    clientes: [
      { id: 'c1', nombre: 'Imprenta Sur', rut: '1-9', recorridoId: 'r1' },
      { id: 'c2', nombre: 'Libros del Norte', rut: '2-7', recorridoId: 'r1' },
      { id: 'c3', nombre: 'Cliente Costa', rut: '3-5', recorridoId: dos ? 'r2' : 'r1' },
      { id: 'c4', nombre: 'Confirmado Sin Nada', rut: '4-3', recorridoId: dos ? 'r2' : 'r1' },
    ],
    trabajos: opciones.trabajos ?? [trab('t1', 11, 'c1'), trab('t2', 12, 'c2'), trab('t3', 13, 'c3')],
    lineas: [
      { id: 'l1', trabajoId: 't1', producto: 'Cuchillo', cantidad: 4 },
      { id: 'l1b', trabajoId: 't1', producto: 'Tijera', cantidad: 1 },
      { id: 'l2', trabajoId: 't2', producto: 'Sierra', cantidad: 4 },
      { id: 'l3', trabajoId: 't3', producto: 'Hacha', cantidad: 2 },
    ],
    movimientos: [mov('m1', 'l1', 4, null, 'a4'), mov('m2', 'l1b', 1, null, 'a4'), mov('m3', 'l2', 4, null, 'a4'), mov('m4', 'l3', 2, null, 'a4')],
    productos: [{ id: 'p1', codigo: 'CU', nombre: 'Cuchillo 20 cm', area: 'afilado' }],
    visitas: opciones.visitas,
  })
  const repo = opciones.envolver ? opciones.envolver(base) : base
  render(<HojaChofer repo={repo} usuario={usuario} />)
  return repo
}

const tarjeta = async (cliente: string) => (await screen.findByRole('heading', { name: cliente })).closest('li')!

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(HOY))
})
afterEach(() => {
  vi.useRealTimers()
})

describe('HojaChofer', () => {
  describe('fecha y recorrido', () => {
    it('la fecha por defecto es hoy en Chile', async () => {
      montar()
      expect(await screen.findByLabelText('Fecha')).toHaveValue(FECHA)
    })
    it('cerca de medianoche sigue siendo el día de Chile (23:30 del martes 24; en UTC ya es 25)', async () => {
      vi.setSystemTime(new Date('2026-11-25T02:30:00Z'))
      montar()
      expect(await screen.findByLabelText('Fecha')).toHaveValue('2026-11-24')
    })
    it('si el chofer tiene varios recorridos ese día, elige cuál ver (arranca en el primero)', async () => {
      montar()
      const grupo = await screen.findByRole('group', { name: 'Recorrido' })
      expect(within(grupo).getByRole('button', { name: /Costa/ })).toHaveAttribute('aria-pressed', 'true')
      expect(screen.getByRole('heading', { name: 'Cliente Costa' })).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Imprenta Sur' })).not.toBeInTheDocument()
      await userEvent.click(within(grupo).getByRole('button', { name: /Sur/ }))
      expect(await screen.findByRole('heading', { name: 'Imprenta Sur' })).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Cliente Costa' })).not.toBeInTheDocument()
    })
    it('con un solo recorrido no hay selector', async () => {
      montar({ dosRecorridos: false })
      await screen.findByRole('heading', { name: 'Imprenta Sur' })
      expect(screen.queryByRole('group', { name: 'Recorrido' })).not.toBeInTheDocument()
    })
    it('un día sin paradas lo dice', async () => {
      montar()
      await screen.findByLabelText('Fecha')
      fireEvent.change(screen.getByLabelText('Fecha'), { target: { value: '2026-11-25' } })
      expect(await screen.findByText('No hay paradas para esta fecha.')).toBeInTheDocument()
    })
  })

  describe('paradas', () => {
    it('cada parada es una tarjeta con lo que hay que entregar', async () => {
      montar({ dosRecorridos: false })
      const c1 = await tarjeta('Imprenta Sur')
      expect(c1).toHaveTextContent('N.º 11')
      expect(c1).toHaveTextContent('Todo lo listo: Cuchillo 4, Tijera 1')
      const c2 = await tarjeta('Libros del Norte')
      expect(c2).toHaveTextContent('Sierra 4')
    })

    it('muestra el estado de la visita de los recorridos lejanos', async () => {
      montar({ visitas: [
        { id: 'v1', fecha: FECHA, clienteId: 'c3', recorridoId: 'r2', confirmada: 'no', requiereConfirmacion: true, solicitada: false },
        { id: 'v2', fecha: FECHA, clienteId: 'c4', recorridoId: 'r2', confirmada: 'si', requiereConfirmacion: true, solicitada: false },
      ] })
      const c3 = await tarjeta('Cliente Costa')
      await waitFor(() => expect(c3).toHaveTextContent('Visita: No confirmada'))
      const c4 = await tarjeta('Confirmado Sin Nada')
      expect(c4).toHaveTextContent('Visita: Confirmada')
      expect(c4).toHaveTextContent('Sin unidades listas')
      expect(within(c4).queryByRole('button', { name: /^Entregar a/ })).not.toBeInTheDocument()
      expect(within(c4).getByRole('button', { name: 'Registrar retiro de Confirmado Sin Nada' })).toBeInTheDocument()
    })
  })

  describe('entregar', () => {
    it('entrega 3 de 4 con el documento 4521: una llamada y queda 1 pendiente', async () => {
      const espia = vi.fn()
      montar({ dosRecorridos: false, envolver: (r) => ({ ...r, entregarUnidades: (...a) => (espia(...a), r.entregarUnidades(...a)) }) })
      const c2 = await tarjeta('Libros del Norte')
      await userEvent.click(within(c2).getByRole('button', { name: 'Entregar a Libros del Norte' }))
      expect(screen.getByLabelText('Cantidad Sierra')).toHaveValue('4') // "Todo" por defecto
      await userEvent.click(screen.getByRole('button', { name: 'Menos Sierra' }))
      await userEvent.type(screen.getByLabelText(/N° de documento/), '4521')
      await userEvent.click(screen.getByRole('button', { name: 'Entregar' }))
      expect(await screen.findByRole('status')).toHaveTextContent('Entrega registrada: 3 unidades · Guía 4521')
      expect(espia).toHaveBeenCalledTimes(1)
      expect(espia).toHaveBeenCalledWith([{ lineaId: 'l2', cantidad: 3 }], '4521')
      await userEvent.click(screen.getByRole('button', { name: 'Listo' }))
      await waitFor(async () => expect(await tarjeta('Libros del Norte')).toHaveTextContent('Sierra 1'))
      expect(await tarjeta('Libros del Norte')).toHaveTextContent('Guía: 4521')
    })

    it('se puede terminar sin foto: la foto nunca se pide', async () => {
      const subir = vi.fn()
      montar({ dosRecorridos: false, envolver: (r) => ({ ...r, subirFotoDocumento: (...a) => (subir(...a), r.subirFotoDocumento(...a)) }) })
      await userEvent.click(within(await tarjeta('Imprenta Sur')).getByRole('button', { name: 'Entregar a Imprenta Sur' }))
      await userEvent.type(screen.getByLabelText(/N° de documento/), '77')
      await userEvent.click(screen.getByRole('button', { name: 'Entregar' }))
      expect(await screen.findByRole('status')).toHaveTextContent('Entrega registrada: 5 unidades · Guía 77')
      await userEvent.click(screen.getByRole('button', { name: 'Listo' }))
      expect(subir).not.toHaveBeenCalled()
      await waitFor(() => expect(screen.queryByRole('heading', { name: 'Imprenta Sur' })).not.toBeInTheDocument())
    })

    it('si la foto falla, la entrega sigue registrada y se avisa en español', async () => {
      montar({ dosRecorridos: false, envolver: (r) => ({ ...r, subirFotoDocumento: () => Promise.reject(new Error('Failed to fetch')) }) })
      await userEvent.click(within(await tarjeta('Imprenta Sur')).getByRole('button', { name: 'Entregar a Imprenta Sur' }))
      await userEvent.type(screen.getByLabelText(/N° de documento/), '77')
      await userEvent.click(screen.getByRole('button', { name: 'Entregar' }))
      await screen.findByRole('status')
      await userEvent.upload(
        screen.getByLabelText('Archivo de la foto del documento del trabajo 11'),
        new File([new Uint8Array([1])], 'a.jpg', { type: 'image/jpeg' }),
      )
      expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo adjuntar la foto. La entrega ya quedó registrada')
      expect(screen.getByRole('status')).toHaveTextContent('Entrega registrada: 5 unidades · Guía 77')
    })

    it('un rechazo del servidor se muestra en español y no cierra el panel', async () => {
      montar({ dosRecorridos: false, envolver: (r) => ({
        ...r,
        entregarUnidades: () => Promise.reject(new ErrorEntrega('«Sierra» tiene 1 unidad lista; no se pueden entregar 4 (faltan 3).')),
      }) })
      await userEvent.click(within(await tarjeta('Libros del Norte')).getByRole('button', { name: 'Entregar a Libros del Norte' }))
      await userEvent.type(screen.getByLabelText(/N° de documento/), '1')
      await userEvent.click(screen.getByRole('button', { name: 'Entregar' }))
      expect(await screen.findByRole('alert')).toHaveTextContent('«Sierra» tiene 1 unidad lista; no se pueden entregar 4 (faltan 3).')
      expect(screen.getByLabelText('Cantidad Sierra')).toBeInTheDocument()
    })

    it('dos toques seguidos en Entregar producen una sola llamada', async () => {
      const espia = vi.fn()
      montar({ dosRecorridos: false, envolver: (r) => ({
        ...r,
        entregarUnidades: (...a) => (espia(...a), new Promise((res) => setTimeout(() => res(r.entregarUnidades(...a)), 20))),
      }) })
      await userEvent.click(within(await tarjeta('Libros del Norte')).getByRole('button', { name: 'Entregar a Libros del Norte' }))
      await userEvent.type(screen.getByLabelText(/N° de documento/), '4521')
      await userEvent.dblClick(screen.getByRole('button', { name: 'Entregar' }))
      expect(espia).toHaveBeenCalledTimes(1)
      await screen.findByRole('status')
    })
  })

  describe('foto del documento en la tarjeta', () => {
    it('un trabajo ya entregado en parte permite adjuntar y luego ver la foto', async () => {
      const abrir = vi.fn()
      montar({
        dosRecorridos: false,
        trabajos: [trab('t1', 11, 'c1'), trab('t2', 12, 'c2', { guiaDespacho: '100' }), trab('t3', 13, 'c3')],
        envolver: (r) => ({ ...r, urlFotoDocumento: (...a) => (abrir(...a), r.urlFotoDocumento(...a)) }),
      })
      const c2 = await tarjeta('Libros del Norte')
      expect(c2).toHaveTextContent('Guía: 100')
      expect(within(await tarjeta('Imprenta Sur')).queryByRole('button', { name: /foto/i })).not.toBeInTheDocument()
      await userEvent.upload(
        within(c2).getByLabelText('Archivo de la foto del documento del trabajo 12'),
        new File([new Uint8Array([1, 2])], 'g.png', { type: 'image/png' }),
      )
      expect(await within(c2).findByText('Foto adjuntada.')).toBeInTheDocument()
      await userEvent.click(within(c2).getByRole('button', { name: 'Ver foto del documento' }))
      expect(await within(c2).findByRole('img', { name: 'Foto del documento del trabajo 12' })).toHaveAttribute('src', expect.stringMatching(/^data:image\/png/))
      expect(abrir).toHaveBeenCalledTimes(1)
    })
  })

  describe('registrar retiro', () => {
    it('abre Recepción con el cliente y ruta propia, y guarda con crearTrabajo(entrada: ruta_propia)', async () => {
      const crear = vi.fn()
      montar({ dosRecorridos: false, envolver: (r) => ({ ...r, crearTrabajo: (d) => (crear(d), r.crearTrabajo(d)) }) })
      await userEvent.click(within(await tarjeta('Imprenta Sur')).getByRole('button', { name: 'Registrar retiro de Imprenta Sur' }))
      expect(await screen.findByLabelText('Ruta propia (retiro)')).toBeChecked()
      expect(screen.queryByLabelText('Cliente')).not.toBeInTheDocument()
      await userEvent.type(screen.getByLabelText('Producto línea 1'), 'Cuchillo 20 cm')
      await userEvent.type(screen.getByLabelText('Cantidad línea 1'), '6')
      await userEvent.click(screen.getByRole('button', { name: 'Guardar trabajo' }))
      expect(await screen.findByText(/Trabajo N\.º \d+ guardado/)).toBeInTheDocument()
      expect(crear).toHaveBeenCalledTimes(1)
      expect(crear).toHaveBeenCalledWith(expect.objectContaining({ clienteId: 'c1', entrada: 'ruta_propia' }))
      await userEvent.click(screen.getByRole('button', { name: 'Cerrar' }))
      expect(screen.queryByRole('button', { name: 'Guardar trabajo' })).not.toBeInTheDocument()
    })

    it('"Cancelar" cierra el formulario sin guardar', async () => {
      const crear = vi.fn()
      montar({ dosRecorridos: false, envolver: (r) => ({ ...r, crearTrabajo: (d) => (crear(d), r.crearTrabajo(d)) }) })
      await userEvent.click(within(await tarjeta('Imprenta Sur')).getByRole('button', { name: 'Registrar retiro de Imprenta Sur' }))
      await userEvent.click(await screen.findByRole('button', { name: 'Cancelar' }))
      expect(screen.queryByRole('button', { name: 'Guardar trabajo' })).not.toBeInTheDocument()
      expect(crear).not.toHaveBeenCalled()
    })
  })

  it('las pantallas de gestión también pueden abrirla', async () => {
    montar({ rol: 'jefe_taller', dosRecorridos: false })
    expect(await tarjeta('Imprenta Sur')).toBeInTheDocument()
  })

  it('las tarjetas y botones son grandes para el dedo (al menos 56 px)', async () => {
    montar({ dosRecorridos: false })
    const boton = within(await tarjeta('Imprenta Sur')).getByRole('button', { name: 'Entregar a Imprenta Sur' })
    expect(boton.className).toMatch(/min-h-14/)
  })

  it('si no carga, lo dice en español', async () => {
    montar({ envolver: (r) => ({ ...r, cargarTodo: () => Promise.reject(new Error('boom')) }) })
    expect(await screen.findByText('No se pudo cargar la información. Revisa tu conexión.')).toBeInTheDocument()
  })
})
