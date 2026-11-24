import { describe, it, expect } from 'vitest'
import { armarRuta, validarVisita, ErrorVisita } from './ruta'
import type { FilaListo } from './listo'
import type { Cliente, Modalidad, Recorrido, Visita } from './tipos'

// 2026-11-23 lunes, 2026-11-24 martes, 2026-11-27 viernes, 2026-11-28 sábado.
const LUNES = '2026-11-23'
const MARTES = '2026-11-24'
const VIERNES = '2026-11-27'
const SABADO = '2026-11-28'

const recorridos: Recorrido[] = [
  { id: 'rN', nombre: 'Norte', dia: 2, camioneta: 'C1', lejano: false },
  { id: 'rC', nombre: 'Costa', dia: 2, camioneta: 'C2', lejano: true },
  { id: 'rL', nombre: 'Centro', dia: 1, camioneta: 'C1', lejano: false },
  { id: 'rV', nombre: 'Valle', dia: 5, camioneta: 'C2', lejano: true },
]
const clientes: Cliente[] = [
  { id: 'c1', nombre: 'Imprenta Sur', rut: '1-9', recorridoId: 'rN' },
  { id: 'c2', nombre: 'Árbol Gráfico', rut: '2-7', recorridoId: 'rN' },
  { id: 'c3', nombre: 'Costa Print', rut: '3-5', recorridoId: 'rC' },
  { id: 'c4', nombre: 'Sin listo', rut: '4-3', recorridoId: 'rN' },
  { id: 'c5', nombre: 'Lunes SpA', rut: '5-1', recorridoId: 'rL' },
  { id: 'c6', nombre: 'Sin Ruta', rut: '6-K', recorridoId: null },
  { id: 'c7', nombre: 'Valle Hnos', rut: '7-8', recorridoId: 'rV' },
  { id: 'c8', nombre: 'Ruta borrada', rut: '8-6', recorridoId: 'r-inexistente' },
]

let numero = 0
function fila(clienteId: string, listas: number, salida: Modalidad = 'ruta_propia', extra: Partial<FilaListo> = {}): FilaListo {
  numero++
  const c = clientes.find((x) => x.id === clienteId)
  const r = recorridos.find((x) => x.id === c?.recorridoId)
  return {
    trabajoId: `t${numero}`, numero, clienteId, clienteNombre: c?.nombre ?? 'Cliente desconocido', area: 'afilado', salida,
    listas, total: 10, entregadas: 0, pendientes: 10, listoDesde: listas > 0 ? '2026-11-23T12:00:00Z' : null,
    recorrido: r?.nombre ?? null, dia: r?.dia ?? null, ...extra,
  }
}
function visita(clienteId: string, fecha: string, extra: Partial<Visita> = {}): Visita {
  return {
    id: `v-${clienteId}-${fecha}`, fecha, clienteId, recorridoId: clientes.find((c) => c.id === clienteId)?.recorridoId ?? '',
    confirmada: 'sin_respuesta', requiereConfirmacion: false, solicitada: false, ...extra,
  }
}

describe('armarRuta: un martes', () => {
  const f1 = fila('c1', 3)
  const f2 = fila('c2', 2)
  const f3 = fila('c3', 1)
  const f4 = fila('c4', 0) // recorrido de martes pero nada listo
  const f5 = fila('c5', 4) // listo, pero su recorrido es de lunes
  const f6 = fila('c6', 2) // sin recorrido
  const filas = [f1, f2, f3, f4, f5, f6]

  it('incluye solo clientes con recorrido de martes y algo listo, ordenados por recorrido y luego por nombre', () => {
    const { paradas } = armarRuta(MARTES, filas, clientes, recorridos, [])
    expect(paradas.map((p) => [p.recorridoNombre, p.clienteNombre])).toEqual([
      ['Costa', 'Costa Print'],
      ['Norte', 'Árbol Gráfico'],
      ['Norte', 'Imprenta Sur'],
    ])
    expect(paradas[2]).toEqual({
      clienteId: 'c1', clienteNombre: 'Imprenta Sur', recorridoId: 'rN', recorridoNombre: 'Norte', dia: 2,
      entregar: [f1], confirmada: 'sin_respuesta', requiereConfirmacion: false, solicitada: false,
    })
  })

  it('agrega al cliente con visita solicitada ese día aunque no le toque ni tenga nada listo', () => {
    const { paradas } = armarRuta(MARTES, filas, clientes, recorridos, [
      visita('c5', MARTES, { solicitada: true, nota: 'Retiro de guillotina' }),
      visita('c4', MARTES, { solicitada: true }),
      visita('c1', LUNES, { solicitada: true }), // otro día: no cambia nada
    ])
    const c5 = paradas.find((p) => p.clienteId === 'c5')
    expect(c5).toMatchObject({
      solicitada: true, nota: 'Retiro de guillotina', visitaId: `v-c5-${MARTES}`, entregar: [f5],
      // su recorrido no sale el martes: es una parada extra, sin recorrido del día
      recorridoId: null, recorridoNombre: null, dia: null,
    })
    expect(paradas.find((p) => p.clienteId === 'c4')).toMatchObject({ solicitada: true, recorridoId: 'rN', entregar: [] })
    // las paradas extra van al final
    expect(paradas.at(-1)?.clienteId).toBe('c5')
  })

  it('una parada de un recorrido lejano requiere confirmación', () => {
    const { paradas } = armarRuta(MARTES, filas, clientes, recorridos, [])
    expect(paradas.find((p) => p.clienteId === 'c3')?.requiereConfirmacion).toBe(true)
    expect(paradas.find((p) => p.clienteId === 'c1')?.requiereConfirmacion).toBe(false)
  })

  it('un cliente con visita confirmada "no" sale marcado y no se oculta', () => {
    const { paradas } = armarRuta(MARTES, filas, clientes, recorridos, [visita('c3', MARTES, { confirmada: 'no' })])
    expect(paradas.find((p) => p.clienteId === 'c3')).toMatchObject({ confirmada: 'no', entregar: [f3], visitaId: `v-c3-${MARTES}` })
  })

  it('una visita confirmada "sí" incluye al cliente aunque no tenga nada listo (hay retiro)', () => {
    const { paradas } = armarRuta(MARTES, filas, clientes, recorridos, [visita('c4', MARTES, { confirmada: 'si' })])
    expect(paradas.find((p) => p.clienteId === 'c4')).toMatchObject({ confirmada: 'si', solicitada: false, entregar: [] })
  })

  it('una visita "no" o "sin respuesta" sin nada listo ni solicitud no agrega parada', () => {
    const { paradas } = armarRuta(MARTES, filas, clientes, recorridos, [
      visita('c4', MARTES, { confirmada: 'no' }),
      visita('c5', MARTES, { confirmada: 'sin_respuesta' }),
    ])
    expect(paradas.map((p) => p.clienteId)).not.toContain('c4')
    expect(paradas.map((p) => p.clienteId)).not.toContain('c5')
  })

  it('los clientes sin recorrido (o con un recorrido que ya no existe) no salen en la ruta, sino en sinRecorrido', () => {
    const f8 = fila('c8', 1)
    const fDesconocido = fila('c-x', 2)
    const r = armarRuta(MARTES, [...filas, f8, fDesconocido], clientes, recorridos, [])
    expect(r.paradas.map((p) => p.clienteId)).not.toContain('c6')
    expect(r.sinRecorrido).toEqual([f8, fDesconocido, f6].sort((a, b) => a.clienteNombre.localeCompare(b.clienteNombre, 'es')))
  })

  it('un cliente sin recorrido con visita solicitada sale como parada extra con lo listo (y deja sinRecorrido)', () => {
    const r = armarRuta(MARTES, filas, clientes, recorridos, [visita('c6', MARTES, { solicitada: true })])
    expect(r.paradas.find((p) => p.clienteId === 'c6')).toMatchObject({ recorridoId: null, entregar: [f6], solicitada: true })
    expect(r.sinRecorrido).toEqual([])
  })

  it('solo se entrega en ruta lo que sale por ruta propia; lo que retira el cliente o va por encomienda se lista aparte', () => {
    const retira = fila('c1', 2, 'cliente')
    const encomienda = fila('c3', 5, 'encomienda')
    const encomiendaSinRuta = fila('c6', 1, 'encomienda')
    const retiraSinListo = fila('c2', 0, 'cliente')
    const r = armarRuta(MARTES, [...filas, retira, encomienda, encomiendaSinRuta, retiraSinListo], clientes, recorridos, [])
    expect(r.paradas.find((p) => p.clienteId === 'c1')?.entregar).toEqual([f1])
    expect(r.paradas.find((p) => p.clienteId === 'c3')?.entregar).toEqual([f3])
    expect(r.retiranEnMostrador).toEqual([retira])
    expect(r.porEncomienda).toEqual([encomienda, encomiendaSinRuta])
    expect(r.sinRecorrido).toEqual([f6])
  })

  it('un cliente que solo tiene listo para retiro en mostrador no genera parada', () => {
    const soloRetira = fila('c4', 3, 'cliente')
    const { paradas } = armarRuta(MARTES, [soloRetira], clientes, recorridos, [])
    expect(paradas).toEqual([])
  })

  it('varios trabajos listos del mismo cliente van en la misma parada, por número', () => {
    const otra = fila('c1', 1)
    const { paradas } = armarRuta(MARTES, [otra, f1], clientes, recorridos, [])
    expect(paradas).toHaveLength(1)
    expect(paradas[0].entregar).toEqual([f1, otra].sort((a, b) => a.numero - b.numero))
  })
})

describe('armarRuta: día de la semana en hora de Chile', () => {
  it('un lunes arma el recorrido de lunes', () => {
    const f = fila('c5', 1)
    const { paradas } = armarRuta(LUNES, [f, fila('c1', 2)], clientes, recorridos, [])
    expect(paradas.map((p) => p.clienteId)).toEqual(['c5'])
  })
  it('un viernes arma el recorrido de viernes (lejano: requiere confirmación)', () => {
    const { paradas } = armarRuta(VIERNES, [fila('c7', 2), fila('c1', 2)], clientes, recorridos, [])
    expect(paradas.map((p) => [p.clienteId, p.requiereConfirmacion])).toEqual([['c7', true]])
  })
  it('un sábado no hay ruta, ni siquiera con visitas solicitadas; lo pendiente sigue listado', () => {
    const f6 = fila('c6', 2)
    const retira = fila('c1', 1, 'cliente')
    const r = armarRuta(SABADO, [fila('c1', 2), f6, retira], clientes, recorridos, [visita('c1', SABADO, { solicitada: true })])
    expect(r.paradas).toEqual([])
    expect(r.sinRecorrido).toEqual([f6])
    expect(r.retiranEnMostrador).toEqual([retira])
  })
  it('una fecha inválida lanza error', () => {
    expect(() => armarRuta('24-11-2026', [], clientes, recorridos, [])).toThrow()
  })
})

describe('validarVisita', () => {
  it('acepta un día hábil válido', () => {
    expect(() => validarVisita({ fecha: MARTES, clienteId: 'c1', confirmada: 'si' })).not.toThrow()
  })
  it('rechaza fechas inválidas, fines de semana, cliente vacío, estado inválido y notas largas', () => {
    const casos: [Parameters<typeof validarVisita>[0], string][] = [
      [{ fecha: '2026-02-31', clienteId: 'c1' }, 'La fecha no es válida.'],
      [{ fecha: 'mañana', clienteId: 'c1' }, 'La fecha no es válida.'],
      [{ fecha: SABADO, clienteId: 'c1' }, 'Las rutas son de lunes a viernes.'],
      [{ fecha: MARTES, clienteId: '' }, 'Elige el cliente.'],
      [{ fecha: MARTES, clienteId: 'c1', confirmada: 'quizas' as never }, 'El estado de la visita no es válido.'],
      [{ fecha: MARTES, clienteId: 'c1', nota: 'x'.repeat(201) }, 'La nota puede tener hasta 200 caracteres.'],
    ]
    for (const [datos, mensaje] of casos) {
      expect(() => validarVisita(datos)).toThrow(new ErrorVisita(mensaje))
    }
  })
})
