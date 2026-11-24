import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import RutaManana from './RutaManana'
import { crearMemoryRepo } from '../../data/memoryRepo'
import type { Repo } from '../../data/repo'
import { ErrorVisita } from '../../dominio/ruta'
import type { Etapa, Modalidad, Movimiento, Rol, Trabajo, Visita } from '../../dominio/tipos'

const etapas: Etapa[] = [
  { id: 'a1', area: 'afilado', orden: 1, nombre: 'Recibido', esListo: false, esFinal: false },
  { id: 'a4', area: 'afilado', orden: 4, nombre: 'Listo', esListo: true, esFinal: false },
  { id: 'a5', area: 'afilado', orden: 5, nombre: 'Entregado', esListo: false, esFinal: true },
]
const trab = (id: string, numero: number, clienteId: string, salida: Modalidad): Trabajo => ({
  id, numero, clienteId, area: 'afilado', entrada: 'cliente', salida, recibidoEn: '2026-11-20T12:00:00Z', urgente: false,
})
const mov = (id: string, lineaId: string, cantidad: number, o: string | null, d: string): Movimiento => ({
  id, lineaId, cantidad, etapaOrigenId: o, etapaDestinoId: d, usuarioId: 'u', creadoEn: '2026-11-20T12:00:00Z',
})

// Miércoles 25 de noviembre de 2026 es el "mañana" de los tests (hoy: martes 24, mediodía en Chile).
const HOY = '2026-11-24T15:00:00Z'
const MANANA = '2026-11-25'

function montar(opciones: { rol?: Rol; envolver?: (r: Repo) => Repo; visitas?: Visita[] } = {}) {
  const base = crearMemoryRepo({
    usuario: { id: 'u1', nombre: 'Ana', rol: opciones.rol ?? 'secretaria' },
    etapas,
    recorridos: [
      { id: 'r1', nombre: 'Norte', dia: 3, camioneta: 'Camioneta A', lejano: false },
      { id: 'r2', nombre: 'Valparaíso', dia: 3, camioneta: 'Camioneta B', lejano: true },
      { id: 'r3', nombre: 'Centro', dia: 1, camioneta: 'Camioneta A', lejano: false },
    ],
    clientes: [
      { id: 'c1', nombre: 'Imprenta Sur', rut: '1-9', recorridoId: 'r1' },
      { id: 'c2', nombre: 'Libros del Norte', rut: '2-7', recorridoId: 'r2' },
      { id: 'c3', nombre: 'Sin Ruta SpA', rut: '3-5', recorridoId: null },
      { id: 'c4', nombre: 'Mostrador Ltda', rut: '4-3', recorridoId: 'r1' },
      { id: 'c5', nombre: 'Encomiendas SA', rut: '5-1', recorridoId: 'r1' },
      { id: 'c6', nombre: 'Cliente Lunes', rut: '6-K', recorridoId: 'r3' },
      { id: 'c7', nombre: 'Nuevo Cliente', rut: '7-8', recorridoId: null },
    ],
    trabajos: [
      trab('t1', 11, 'c1', 'ruta_propia'), trab('t2', 12, 'c2', 'ruta_propia'), trab('t3', 13, 'c3', 'ruta_propia'),
      trab('t4', 14, 'c4', 'cliente'), trab('t5', 15, 'c5', 'encomienda'), trab('t6', 16, 'c6', 'ruta_propia'),
    ],
    lineas: [
      { id: 'l1', trabajoId: 't1', producto: 'Cuchillo', cantidad: 4 },
      { id: 'l1b', trabajoId: 't1', producto: 'Tijera', cantidad: 1 },
      { id: 'l2', trabajoId: 't2', producto: 'Sierra', cantidad: 2 },
      { id: 'l3', trabajoId: 't3', producto: 'Hacha', cantidad: 1 },
      { id: 'l4', trabajoId: 't4', producto: 'Serrucho', cantidad: 2 },
      { id: 'l5', trabajoId: 't5', producto: 'Formón', cantidad: 3 },
      { id: 'l6', trabajoId: 't6', producto: 'Lima', cantidad: 3 },
    ],
    movimientos: ['l1', 'l1b', 'l2', 'l3', 'l4', 'l5', 'l6'].flatMap((l, i) => {
      const n = { l1: 4, l1b: 1, l2: 2, l3: 1, l4: 2, l5: 3, l6: 3 }[l]!
      return [mov(`m${i}`, l, n, null, 'a4')]
    }),
    visitas: opciones.visitas,
  })
  const repo = opciones.envolver ? opciones.envolver(base) : base
  render(<RutaManana repo={repo} usuario={{ id: 'u1', nombre: 'Ana', rol: opciones.rol ?? 'secretaria' }} />)
  return repo
}

const seccion = (nombre: RegExp | string) => screen.findByRole('heading', { name: nombre }).then((h) => h.closest('section')!)
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(HOY))
})
afterEach(() => {
  vi.useRealTimers()
})

describe('RutaManana', () => {
  describe('fecha', () => {
    it('por defecto es el próximo día hábil', async () => {
      montar()
      expect(await screen.findByLabelText('Fecha')).toHaveValue(MANANA)
    })
    it('un viernes apunta al lunes', async () => {
      vi.setSystemTime(new Date('2026-11-27T15:00:00Z'))
      montar()
      expect(await screen.findByLabelText('Fecha')).toHaveValue('2026-11-30')
    })
    it('cerca de medianoche usa el día de Chile, no el de UTC (23:30 del martes 24 en Chile)', async () => {
      vi.setSystemTime(new Date('2026-11-25T02:30:00Z'))
      montar()
      expect(await screen.findByLabelText('Fecha')).toHaveValue('2026-11-25')
    })
    it('al cambiar la fecha carga las visitas de ese día', async () => {
      const espia = vi.fn()
      montar({ envolver: (r) => ({ ...r, listarVisitas: (f) => (espia(f), r.listarVisitas(f)) }) })
      await screen.findByLabelText('Fecha')
      await waitFor(() => expect(espia).toHaveBeenCalledWith(MANANA))
      fireEvent.change(screen.getByLabelText('Fecha'), { target: { value: '2026-11-26' } })
      await waitFor(() => expect(espia).toHaveBeenCalledWith('2026-11-26'))
    })
    it('un fin de semana avisa que no hay ruta, pero lo listo para otras salidas sigue a la vista', async () => {
      montar()
      await screen.findByLabelText('Fecha')
      fireEvent.change(screen.getByLabelText('Fecha'), { target: { value: '2026-11-28' } })
      expect(await screen.findByText('Sábado y domingo no hay ruta.')).toBeInTheDocument()
      const mostrador = await seccion('Retiran en mostrador')
      expect(within(mostrador).getByText('Mostrador Ltda')).toBeInTheDocument()
    })
  })

  describe('paradas', () => {
    it('agrupa por recorrido y muestra cliente y unidades listas por producto', async () => {
      montar()
      const norte = await seccion(/Norte · Camioneta A/)
      const fila = within(norte).getByText('Imprenta Sur').closest('li')!
      expect(fila).toHaveTextContent('N.º 11')
      expect(fila).toHaveTextContent('Cuchillo 4')
      expect(fila).toHaveTextContent('Tijera 1')
      const valpo = await seccion(/Valparaíso · Camioneta B/)
      expect(within(valpo).getByText('Libros del Norte')).toBeInTheDocument()
      expect(screen.queryByText('Cliente Lunes', { selector: 'span' })).not.toBeInTheDocument() // su recorrido sale el lunes
      // ...pero no se pierde de vista: se avisa que hay algo listo para otro día de ruta.
      expect(screen.getByText('Hay 1 trabajo listo para otros días de ruta (no entra en esta fecha).')).toBeInTheDocument()
    })

    it('la confirmación solo se ofrece en recorridos lejanos y arranca en "Sin respuesta"', async () => {
      montar()
      const valpo = await seccion(/Valparaíso/)
      const grupo = within(valpo).getByRole('radiogroup', { name: 'Visita Libros del Norte' })
      expect(within(grupo).getByLabelText('Sin respuesta')).toBeChecked()
      const norte = await seccion(/Norte · Camioneta A/)
      expect(within(norte).queryByRole('radiogroup')).not.toBeInTheDocument()
    })

    it('marcar "Sí" guarda la visita y recarga: queda marcada', async () => {
      const marcar = vi.fn()
      const listar = vi.fn()
      montar({ envolver: (r) => ({ ...r, marcarVisita: (...a) => (marcar(...a), r.marcarVisita(...a)), listarVisitas: (f) => (listar(f), r.listarVisitas(f)) }) })
      const valpo = await seccion(/Valparaíso/)
      const antes = listar.mock.calls.length
      await userEvent.click(within(valpo).getByLabelText('Sí'))
      expect(marcar).toHaveBeenCalledWith(MANANA, 'c2', 'si')
      await waitFor(() => expect(within(valpo).getByLabelText('Sí')).toBeChecked())
      expect(listar.mock.calls.length).toBeGreaterThan(antes)
    })

    it('una visita marcada "No" no se oculta', async () => {
      montar({ visitas: [{ id: 'v1', fecha: MANANA, clienteId: 'c2', recorridoId: 'r2', confirmada: 'no', requiereConfirmacion: true, solicitada: false }] })
      const valpo = await seccion(/Valparaíso/)
      await waitFor(() => expect(within(valpo).getByLabelText('No')).toBeChecked())
      expect(within(valpo).getByText('Libros del Norte')).toBeInTheDocument()
    })

    it('un fallo al marcar se muestra en español', async () => {
      montar({ envolver: (r) => ({ ...r, marcarVisita: () => Promise.reject(new Error('Failed to fetch')) }) })
      const valpo = await seccion(/Valparaíso/)
      await userEvent.click(within(valpo).getByLabelText('No'))
      const alerta = await screen.findByRole('alert')
      expect(alerta).toHaveTextContent('No se pudo guardar la visita. Revisa tu conexión e inténtalo de nuevo.')
      expect(alerta).not.toHaveTextContent('Failed to fetch')
      expect(within(valpo).getByLabelText('Sin respuesta')).toBeChecked()
    })

    it('un error de regla de la visita llega tal cual (ya en español)', async () => {
      montar({ envolver: (r) => ({ ...r, marcarVisita: () => Promise.reject(new ErrorVisita('No tienes permiso para modificar las visitas.')) }) })
      const valpo = await seccion(/Valparaíso/)
      await userEvent.click(within(valpo).getByLabelText('Sí'))
      expect(await screen.findByRole('alert')).toHaveTextContent('No tienes permiso para modificar las visitas.')
    })

    it('si las visitas no cargan, lo dice en español', async () => {
      montar({ envolver: (r) => ({ ...r, listarVisitas: () => Promise.reject(new Error('boom')) }) })
      expect(await screen.findByRole('alert')).toHaveTextContent('No se pudieron cargar las visitas. Revisa tu conexión.')
    })
  })

  describe('visita extra', () => {
    it('busca el cliente como en Recepción y agrega la visita con su nota', async () => {
      const extra = vi.fn()
      montar({ envolver: (r) => ({ ...r, agregarVisitaExtra: (...a) => (extra(...a), r.agregarVisitaExtra(...a)) }) })
      await screen.findByLabelText('Fecha')
      await userEvent.click(screen.getByRole('button', { name: 'Agregar visita extra' }))
      await userEvent.type(screen.getByLabelText('Cliente'), 'nuevo')
      await userEvent.click(await screen.findByRole('button', { name: /Nuevo Cliente/ }))
      await userEvent.type(screen.getByLabelText('Nota (opcional)'), 'Retira cheques')
      await userEvent.click(screen.getByRole('button', { name: 'Agregar' }))
      expect(extra).toHaveBeenCalledWith(MANANA, 'c7', 'Retira cheques')
      const extras = await seccion('Visitas extra')
      expect(within(extras).getByText('Nuevo Cliente')).toBeInTheDocument()
      expect(extras).toHaveTextContent('Retira cheques')
      expect(screen.queryByLabelText('Nota (opcional)')).not.toBeInTheDocument()
    })

    it('sin cliente elegido no agrega y pide elegirlo', async () => {
      const extra = vi.fn()
      montar({ envolver: (r) => ({ ...r, agregarVisitaExtra: (...a) => (extra(...a), r.agregarVisitaExtra(...a)) }) })
      await userEvent.click(await screen.findByRole('button', { name: 'Agregar visita extra' }))
      await userEvent.click(screen.getByRole('button', { name: 'Agregar' }))
      expect(await screen.findByRole('alert')).toHaveTextContent('Elige el cliente de la visita.')
      expect(extra).not.toHaveBeenCalled()
    })

    it('dos toques seguidos en Agregar producen una sola llamada', async () => {
      const extra = vi.fn()
      montar({ envolver: (r) => ({ ...r, agregarVisitaExtra: (...a) => (extra(...a), new Promise((res) => setTimeout(() => res(r.agregarVisitaExtra(...a)), 20))) }) })
      await userEvent.click(await screen.findByRole('button', { name: 'Agregar visita extra' }))
      await userEvent.type(screen.getByLabelText('Cliente'), 'nuevo')
      await userEvent.click(await screen.findByRole('button', { name: /Nuevo Cliente/ }))
      await userEvent.dblClick(screen.getByRole('button', { name: 'Agregar' }))
      expect(extra).toHaveBeenCalledTimes(1)
      await seccion('Visitas extra')
    })

    it('el error de la nota larga llega en español', async () => {
      montar()
      await userEvent.click(await screen.findByRole('button', { name: 'Agregar visita extra' }))
      await userEvent.type(screen.getByLabelText('Cliente'), 'nuevo')
      await userEvent.click(await screen.findByRole('button', { name: /Nuevo Cliente/ }))
      fireEvent.change(screen.getByLabelText('Nota (opcional)'), { target: { value: 'x'.repeat(201) } })
      await userEvent.click(screen.getByRole('button', { name: 'Agregar' }))
      expect(await screen.findByRole('alert')).toHaveTextContent('200')
    })
  })

  describe('lo listo que no va en la camioneta', () => {
    it('muestra Sin recorrido, Retiran en mostrador y Por encomienda sin perder ninguna fila', async () => {
      montar()
      const sin = await seccion('Sin recorrido')
      expect(within(sin).getByText('Sin Ruta SpA')).toBeInTheDocument()
      expect(sin).toHaveTextContent('Hacha 1')
      const mostrador = await seccion('Retiran en mostrador')
      expect(within(mostrador).getByText('Mostrador Ltda')).toBeInTheDocument()
      expect(mostrador).toHaveTextContent('Serrucho 2')
      const enco = await seccion('Por encomienda')
      expect(within(enco).getByText('Encomiendas SA')).toBeInTheDocument()
      // 3 trabajos con recorrido y camioneta (11, 12) + 3 filas sueltas (13, 14, 15) = todo lo listo del día; el 16 es del lunes.
      const todos = screen.getAllByText(/N\.º 1\d/).map((e) => e.textContent)
      for (const n of ['N.º 11', 'N.º 12', 'N.º 13', 'N.º 14', 'N.º 15']) expect(todos.some((t) => t?.includes(n))).toBe(true)
    })

    it('cambiar la salida de un retiro en mostrador a "Ruta propia" lo pasa a la parada de su recorrido', async () => {
      const salida = vi.fn()
      montar({ envolver: (r) => ({ ...r, actualizarSalida: (...a) => (salida(...a), r.actualizarSalida(...a)) }) })
      const mostrador = await seccion('Retiran en mostrador')
      await userEvent.selectOptions(within(mostrador).getByLabelText('Salida del trabajo N.º 14'), 'ruta_propia')
      expect(salida).toHaveBeenCalledWith('t4', 'ruta_propia')
      const norte = await seccion(/Norte · Camioneta A/)
      await waitFor(() => expect(within(norte).getByText('Mostrador Ltda')).toBeInTheDocument())
      expect(screen.queryByRole('heading', { name: 'Retiran en mostrador' })).not.toBeInTheDocument()
    })

    it('un fallo al cambiar la salida se muestra en español y la fila no se mueve', async () => {
      montar({ envolver: (r) => ({ ...r, actualizarSalida: () => Promise.reject(new Error('Failed to fetch')) }) })
      const enco = await seccion('Por encomienda')
      await userEvent.selectOptions(within(enco).getByLabelText('Salida del trabajo N.º 15'), 'ruta_propia')
      expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo cambiar la salida. Revisa tu conexión e inténtalo de nuevo.')
      expect(within(await seccion('Por encomienda')).getByText('Encomiendas SA')).toBeInTheDocument()
    })

    it('el retiro en mostrador se entrega con documento: una llamada y mensaje de confirmación', async () => {
      const entregar = vi.fn()
      montar({ envolver: (r) => ({ ...r, entregarUnidades: (...a) => (entregar(...a), r.entregarUnidades(...a)) }) })
      const mostrador = await seccion('Retiran en mostrador')
      await userEvent.click(within(mostrador).getByRole('button', { name: 'Entregar en mostrador' }))
      await userEvent.type(await screen.findByLabelText(/N° de documento/), '4521')
      await userEvent.dblClick(screen.getByRole('button', { name: 'Entregar' }))
      expect(await screen.findByRole('status')).toHaveTextContent('Entrega registrada: 2 unidades · Guía 4521')
      expect(entregar).toHaveBeenCalledTimes(1)
      expect(entregar).toHaveBeenCalledWith([{ lineaId: 'l4', cantidad: 2 }], '4521')
      await userEvent.click(screen.getByRole('button', { name: 'Listo' }))
      await waitFor(() => expect(screen.queryByRole('heading', { name: 'Retiran en mostrador' })).not.toBeInTheDocument())
    })
  })

  it('se imprime como hoja simple: los controles no salen en papel', async () => {
    montar()
    const controles = await screen.findByRole('group', { name: 'Controles de la ruta' })
    expect(controles).toHaveClass('print:hidden')
    expect(screen.getByText(/miércoles 25 de noviembre/i)).toBeInTheDocument()
  })

  it('un chofer también puede verla', async () => {
    montar({ rol: 'chofer' })
    expect(await seccion(/Norte · Camioneta A/)).toBeInTheDocument()
  })

  it('si lo listo no carga, lo dice en español', async () => {
    montar({ envolver: (r) => ({ ...r, cargarTodo: () => Promise.reject(new Error('boom')) }) })
    expect(await screen.findByText('No se pudo cargar la información. Revisa tu conexión.')).toBeInTheDocument()
  })
})
