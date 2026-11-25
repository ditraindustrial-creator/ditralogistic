import { describe, it, expect } from 'vitest'
import { armarRuta, recorridoDelChofer, validarVisita, ErrorVisita } from './ruta'
import type { FilaListo } from './listo'
import type { Asignacion, Cliente, Modalidad, Recorrido, Visita } from './tipos'

// 2026-11-23 lunes, 2026-11-24 martes, 2026-11-25 miércoles, 2026-11-26 jueves, 2026-11-27 viernes, 2026-11-28 sábado.
const LUNES = '2026-11-23'
const MARTES = '2026-11-24'
const MIERCOLES = '2026-11-25'
const JUEVES = '2026-11-26'
const VIERNES = '2026-11-27'
const SABADO = '2026-11-28'

const recorridos: Recorrido[] = [
  { id: 'rN', nombre: 'Norte', dia: 2, camioneta: 'C1', lejano: false },
  { id: 'rC', nombre: 'Costa', dia: 2, camioneta: 'C2', lejano: true },
  { id: 'rL', nombre: 'Centro', dia: 1, camioneta: 'C1', lejano: false },
  { id: 'rV', nombre: 'Valle', dia: 5, camioneta: 'C2', lejano: true },
]
const clientes: Cliente[] = [
  { id: 'c1', nombre: 'Imprenta Sur', rut: '1-9' },
  { id: 'c2', nombre: 'Árbol Gráfico', rut: '2-7' },
  { id: 'c3', nombre: 'Costa Print', rut: '3-5' },
  { id: 'c4', nombre: 'Sin listo', rut: '4-3' },
  { id: 'c5', nombre: 'Lunes SpA', rut: '5-1' },
  { id: 'c6', nombre: 'Sin Ruta', rut: '6-K' },
  { id: 'c7', nombre: 'Valle Hnos', rut: '7-8' },
  { id: 'c8', nombre: 'Ruta borrada', rut: '8-6' },
]
const fija = (clienteId: string, recorridoId: string, orden = 0): Asignacion => ({ clienteId, recorridoId, fija: true, orden })
const aPedido = (clienteId: string, recorridoId: string, orden = 0): Asignacion => ({ clienteId, recorridoId, fija: false, orden })
// Un recorrido por cliente (como antes de Task 10), todos fijos; c6 sin asignación; c8 en un recorrido borrado.
const asignaciones: Asignacion[] = [
  fija('c1', 'rN'), fija('c2', 'rN'), fija('c3', 'rC'), fija('c4', 'rN'), fija('c5', 'rL'), fija('c7', 'rV'), fija('c8', 'r-inexistente'),
]

let numero = 0
function fila(clienteId: string, listas: number, salida: Modalidad = 'ruta_propia', extra: Partial<FilaListo> = {}): FilaListo {
  numero++
  const c = clientes.find((x) => x.id === clienteId)
  return {
    trabajoId: `t${numero}`, numero, clienteId, clienteNombre: c?.nombre ?? 'Cliente desconocido', area: 'afilado', salida,
    listas, total: 10, entregadas: 0, pendientes: 10, listoDesde: listas > 0 ? '2026-11-23T12:00:00Z' : null,
    rutas: [], proximaRuta: null, ...extra,
  }
}
function visita(clienteId: string, fecha: string, extra: Partial<Visita> = {}): Visita {
  return {
    id: `v-${clienteId}-${fecha}`, fecha, clienteId, recorridoId: null,
    confirmada: 'sin_respuesta', requiereConfirmacion: false, solicitada: false, ...extra,
  }
}
const ids = (r: ReturnType<typeof armarRuta>) => [...r.paradas, ...r.pasarARetirar].map((p) => p.clienteId)

describe('armarRuta: un martes', () => {
  const f1 = fila('c1', 3)
  const f2 = fila('c2', 2)
  const f3 = fila('c3', 1)
  const f4 = fila('c4', 0) // recorrido de martes pero nada listo
  const f5 = fila('c5', 4) // listo, pero su recorrido es de lunes
  const f6 = fila('c6', 2) // sin recorrido
  const filas = [f1, f2, f3, f4, f5, f6]

  it('paradas: clientes con recorrido de martes y algo listo, ordenados por recorrido y luego por nombre', () => {
    const { paradas } = armarRuta(MARTES, filas, clientes, recorridos, asignaciones, [])
    expect(paradas.map((p) => [p.recorridoNombre, p.clienteNombre])).toEqual([
      ['Costa', 'Costa Print'],
      ['Norte', 'Árbol Gráfico'],
      ['Norte', 'Imprenta Sur'],
    ])
    expect(paradas[2]).toEqual({
      clienteId: 'c1', clienteNombre: 'Imprenta Sur', recorridoId: 'rN', recorridoNombre: 'Norte', dia: 2,
      entregar: [f1], entregasPlanificadas: [], confirmada: 'sin_respuesta', requiereConfirmacion: false, solicitada: false, fija: true, orden: 0,
    })
  })

  it('"Pasar a retirar": TODO cliente cuyo recorrido sale ese día, aunque no tenga nada que entregar', () => {
    const r = armarRuta(MARTES, filas, clientes, recorridos, asignaciones, [])
    expect(r.pasarARetirar.map((p) => [p.recorridoNombre, p.clienteNombre, p.entregar.length])).toEqual([['Norte', 'Sin listo', 0]])
    // sin ningún trabajo: igual aparecen todos los clientes del martes
    const vacia = armarRuta(MARTES, [], clientes, recorridos, asignaciones, [])
    expect(vacia.paradas).toEqual([])
    expect(vacia.pasarARetirar.map((p) => p.clienteId)).toEqual(['c3', 'c2', 'c1', 'c4'])
  })

  it('un cliente lejano sin nada que entregar sale en "Pasar a retirar" y requiere confirmación (para llamarlo el día antes)', () => {
    const r = armarRuta(MARTES, [f1], clientes, recorridos, asignaciones, [])
    expect(r.pasarARetirar.find((p) => p.clienteId === 'c3')).toMatchObject({ recorridoId: 'rC', requiereConfirmacion: true, entregar: [] })
  })

  it('agrega al cliente con visita solicitada ese día aunque no le toque ni tenga nada listo', () => {
    const { paradas } = armarRuta(MARTES, filas, clientes, recorridos, asignaciones, [
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
    expect(paradas.map((p) => p.clienteId)).not.toContain('c4')
    // las paradas extra van al final
    expect(paradas.at(-1)?.clienteId).toBe('c5')
  })

  it('un cliente con visita solicitada y nada que entregar va a "Pasar a retirar", marcado como solicitado', () => {
    const r = armarRuta(MARTES, filas, clientes, recorridos, asignaciones, [visita('c4', MARTES, { solicitada: true })])
    expect(r.pasarARetirar.find((p) => p.clienteId === 'c4')).toMatchObject({ solicitada: true, recorridoId: 'rN', entregar: [] })
  })

  it('una visita extra usa el "lejano" del recorrido del cliente de ESE día: si no tiene recorrido ese día, no requiere confirmación', () => {
    // c7 solo está en Valle (viernes, lejano): el martes es una visita extra sin recorrido del día.
    const r = armarRuta(MARTES, filas, clientes, recorridos, asignaciones, [visita('c7', MARTES, { solicitada: true })])
    expect(r.pasarARetirar.find((p) => p.clienteId === 'c7')).toMatchObject({ recorridoId: null, solicitada: true, requiereConfirmacion: false, fija: false })
    // la marca guardada en la visita sigue mandando
    const marcada = armarRuta(MARTES, filas, clientes, recorridos, asignaciones, [visita('c7', MARTES, { solicitada: true, requiereConfirmacion: true })])
    expect(marcada.pasarARetirar.find((p) => p.clienteId === 'c7')?.requiereConfirmacion).toBe(true)
    const r2 = armarRuta(MARTES, filas, clientes, recorridos, asignaciones, [visita('c5', MARTES, { solicitada: true })])
    expect(r2.paradas.find((p) => p.clienteId === 'c5')?.requiereConfirmacion).toBe(false)
  })

  it('una parada de un recorrido lejano requiere confirmación', () => {
    const { paradas } = armarRuta(MARTES, filas, clientes, recorridos, asignaciones, [])
    expect(paradas.find((p) => p.clienteId === 'c3')?.requiereConfirmacion).toBe(true)
    expect(paradas.find((p) => p.clienteId === 'c1')?.requiereConfirmacion).toBe(false)
  })

  it('un cliente con visita confirmada "no" sale marcado y no se oculta', () => {
    const { paradas } = armarRuta(MARTES, filas, clientes, recorridos, asignaciones, [visita('c3', MARTES, { confirmada: 'no' })])
    expect(paradas.find((p) => p.clienteId === 'c3')).toMatchObject({ confirmada: 'no', entregar: [f3], visitaId: `v-c3-${MARTES}` })
  })

  it('una visita confirmada "sí" de un cliente de otro día lo incluye aunque no tenga nada listo (hay retiro)', () => {
    const r = armarRuta(MARTES, filas, clientes, recorridos, asignaciones, [visita('c4', MARTES, { confirmada: 'si' }), visita('c7', MARTES, { confirmada: 'si' })])
    expect(r.pasarARetirar.find((p) => p.clienteId === 'c4')).toMatchObject({ confirmada: 'si', solicitada: false, entregar: [] })
    expect(r.pasarARetirar.find((p) => p.clienteId === 'c7')).toMatchObject({ confirmada: 'si', recorridoId: null })
  })

  it('una visita "no" del cliente del día lo deja visible y marcado; "sin respuesta" de un cliente de otro día no lo agrega', () => {
    const r = armarRuta(MARTES, filas, clientes, recorridos, asignaciones, [
      visita('c4', MARTES, { confirmada: 'no' }),
      visita('c5', MARTES, { confirmada: 'sin_respuesta' }),
    ])
    expect(r.pasarARetirar.find((p) => p.clienteId === 'c4')?.confirmada).toBe('no')
    expect([...r.paradas, ...r.pasarARetirar].map((p) => p.clienteId)).not.toContain('c5')
  })

  it('los clientes sin recorrido (o con un recorrido que ya no existe) no salen en la ruta, sino en sinRecorrido', () => {
    const f8 = fila('c8', 1)
    const fDesconocido = fila('c-x', 2)
    const r = armarRuta(MARTES, [...filas, f8, fDesconocido], clientes, recorridos, asignaciones, [])
    expect([...r.paradas, ...r.pasarARetirar].map((p) => p.clienteId)).not.toContain('c6')
    expect([...r.paradas, ...r.pasarARetirar].map((p) => p.clienteId)).not.toContain('c8')
    expect(r.sinRecorrido).toEqual([f8, fDesconocido, f6].sort((a, b) => a.clienteNombre.localeCompare(b.clienteNombre, 'es')))
  })

  it('un cliente sin recorrido con visita solicitada sale como parada extra con lo listo (y deja sinRecorrido)', () => {
    const r = armarRuta(MARTES, filas, clientes, recorridos, asignaciones, [visita('c6', MARTES, { solicitada: true })])
    expect(r.paradas.find((p) => p.clienteId === 'c6')).toMatchObject({ recorridoId: null, entregar: [f6], solicitada: true })
    expect(r.sinRecorrido).toEqual([])
  })

  it('solo se entrega en ruta lo que sale por ruta propia; lo que retira el cliente o va por encomienda se lista aparte', () => {
    const retira = fila('c1', 2, 'cliente')
    const encomienda = fila('c3', 5, 'encomienda')
    const encomiendaSinRuta = fila('c6', 1, 'encomienda')
    const retiraSinListo = fila('c2', 0, 'cliente')
    const r = armarRuta(MARTES, [...filas, retira, encomienda, encomiendaSinRuta, retiraSinListo], clientes, recorridos, asignaciones, [])
    expect(r.paradas.find((p) => p.clienteId === 'c1')?.entregar).toEqual([f1])
    expect(r.paradas.find((p) => p.clienteId === 'c3')?.entregar).toEqual([f3])
    expect(r.retiranEnMostrador).toEqual([retira])
    expect(r.porEncomienda).toEqual([encomienda, encomiendaSinRuta])
    expect(r.sinRecorrido).toEqual([f6])
  })

  it('un cliente que solo tiene listo para retiro en mostrador no genera parada de entrega (sí sale en "Pasar a retirar")', () => {
    const soloRetira = fila('c4', 3, 'cliente')
    const r = armarRuta(MARTES, [soloRetira], clientes, recorridos, asignaciones, [])
    expect(r.paradas).toEqual([])
    expect(r.pasarARetirar.find((p) => p.clienteId === 'c4')?.entregar).toEqual([])
  })

  it('varios trabajos listos del mismo cliente van en la misma parada, por número', () => {
    const otra = fila('c1', 1)
    const { paradas } = armarRuta(MARTES, [otra, f1], clientes, recorridos, asignaciones, [])
    expect(paradas).toHaveLength(1)
    expect(paradas[0].entregar).toEqual([f1, otra].sort((a, b) => a.numero - b.numero))
  })
})

describe('armarRuta: día de la semana en hora de Chile', () => {
  it('un lunes arma el recorrido de lunes', () => {
    const f = fila('c5', 1)
    const r = armarRuta(LUNES, [f, fila('c1', 2)], clientes, recorridos, asignaciones, [])
    expect(r.paradas.map((p) => p.clienteId)).toEqual(['c5'])
    expect(r.pasarARetirar).toEqual([])
  })
  it('un viernes arma el recorrido de viernes (lejano: requiere confirmación)', () => {
    const r = armarRuta(VIERNES, [fila('c7', 2), fila('c1', 2)], clientes, recorridos, asignaciones, [])
    expect(r.paradas.map((p) => [p.clienteId, p.requiereConfirmacion])).toEqual([['c7', true]])
    expect(r.pasarARetirar).toEqual([])
  })
  it('un sábado no hay ruta, ni siquiera con visitas solicitadas; lo pendiente sigue listado', () => {
    const f6 = fila('c6', 2)
    const retira = fila('c1', 1, 'cliente')
    const r = armarRuta(SABADO, [fila('c1', 2), f6, retira], clientes, recorridos, asignaciones, [visita('c1', SABADO, { solicitada: true })])
    expect(r.paradas).toEqual([])
    expect(r.pasarARetirar).toEqual([])
    expect(r.sinRecorrido).toEqual([f6])
    expect(r.retiranEnMostrador).toEqual([retira])
  })
  it('una fecha inválida lanza error', () => {
    expect(() => armarRuta('24-11-2026', [], clientes, recorridos, asignaciones, [])).toThrow()
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

describe('armarRuta: un cliente en varios recorridos (Task 10)', () => {
  // Hoja real: lunes a viernes, dos choferes por día; un cliente sale 2 o 3 días.
  const semana: Recorrido[] = [
    { id: 'lunR', nombre: 'Lunes · Rodrigo Lagos', dia: 1, camioneta: 'C1', lejano: false, chofer: 'Rodrigo Lagos' },
    { id: 'lunA', nombre: 'Lunes · Angelo', dia: 1, camioneta: 'C2', lejano: false, chofer: 'Angelo' },
    { id: 'marR', nombre: 'Martes · Rodrigo Lagos', dia: 2, camioneta: 'C1', lejano: true, chofer: 'Rodrigo Lagos' },
    { id: 'mieR', nombre: 'Miércoles · Rodrigo Lagos', dia: 3, camioneta: 'C1', lejano: false, chofer: 'Rodrigo Lagos' },
    { id: 'vieA', nombre: 'Viernes · Angelo', dia: 5, camioneta: 'C2', lejano: false, chofer: 'Angelo' },
  ]
  const gente: Cliente[] = [
    { id: 'x1', nombre: 'Tres Días SpA', rut: '11-1' },
    { id: 'x2', nombre: 'A Pedido Ltda', rut: '12-K' },
    { id: 'x3', nombre: 'Beta Fija', rut: '13-8' },
    { id: 'x4', nombre: 'Alfa Fija', rut: '14-6' },
    { id: 'x5', nombre: 'Doble Lunes', rut: '15-4' },
    { id: 'x6', nombre: 'Nadie', rut: '16-2' },
  ]
  const fx = (clienteId: string, listas: number, salida: Modalidad = 'ruta_propia'): FilaListo => {
    numero++
    return {
      trabajoId: `x${numero}`, numero, clienteId, clienteNombre: gente.find((c) => c.id === clienteId)?.nombre ?? '?', area: 'afilado', salida,
      listas, total: 10, entregadas: 0, pendientes: 10, listoDesde: listas > 0 ? '2026-11-23T12:00:00Z' : null, rutas: [], proximaRuta: null,
    }
  }
  const ruta = (fecha: string, filas: FilaListo[], asig: Asignacion[], vs: Visita[] = []) => armarRuta(fecha, filas, gente, semana, asig, vs)

  it('un cliente de lunes, miércoles y viernes sale esos tres días (en el recorrido de cada día) y ni martes ni jueves', () => {
    const asig = [fija('x1', 'lunR'), fija('x1', 'mieR'), fija('x1', 'vieA')]
    const recorridoDelDia = (fecha: string) => {
      const r = ruta(fecha, [], asig)
      return [...r.paradas, ...r.pasarARetirar].filter((p) => p.clienteId === 'x1').map((p) => p.recorridoId)
    }
    expect(recorridoDelDia(LUNES)).toEqual(['lunR'])
    expect(recorridoDelDia(MIERCOLES)).toEqual(['mieR'])
    expect(recorridoDelDia(VIERNES)).toEqual(['vieA'])
    expect(recorridoDelDia(MARTES)).toEqual([])
    expect(recorridoDelDia(JUEVES)).toEqual([])
    // con algo listo, se entrega en el recorrido de cada uno de sus días; el martes queda "para otro día"
    const f = fx('x1', 2)
    expect(ruta(LUNES, [f], asig).paradas.map((p) => [p.recorridoId, p.entregar])).toEqual([['lunR', [f]]])
    expect(ruta(VIERNES, [f], asig).paradas.map((p) => [p.recorridoId, p.entregar])).toEqual([['vieA', [f]]])
    const martes = ruta(MARTES, [f], asig)
    expect(ids(martes)).toEqual([])
    expect(martes.sinRecorrido).toEqual([]) // tiene recorridos: no es "sin recorrido"
  })

  it('cliente fijo sin nada que entregar va a "Pasar a retirar"; a pedido sin nada no aparece', () => {
    const r = ruta(LUNES, [], [fija('x3', 'lunR'), aPedido('x2', 'lunR')])
    expect(r.pasarARetirar.map((p) => [p.clienteId, p.fija])).toEqual([['x3', true]])
    expect(ids(r)).not.toContain('x2')
  })

  it('cliente a pedido aparece si tiene algo listo por ruta propia (no si solo hay retiro en mostrador o encomienda)', () => {
    const asig = [aPedido('x2', 'lunR', 4)]
    const f = fx('x2', 3)
    const r = ruta(LUNES, [f], asig)
    expect(r.paradas).toEqual([expect.objectContaining({ clienteId: 'x2', recorridoId: 'lunR', fija: false, orden: 4, entregar: [f] })])
    expect(ids(ruta(LUNES, [fx('x2', 3, 'cliente'), fx('x2', 1, 'encomienda')], asig))).toEqual([])
    expect(ids(ruta(LUNES, [fx('x2', 0)], asig))).toEqual([]) // en curso pero sin nada listo
  })

  it('cliente a pedido aparece con una visita solicitada o confirmada "sí"; con "no" o "sin respuesta" y nada listo, no', () => {
    const asig = [aPedido('x2', 'marR')]
    const solicitada = ruta(MARTES, [], asig, [visita('x2', MARTES, { solicitada: true, nota: 'Llamó' })])
    expect(solicitada.pasarARetirar).toEqual([
      expect.objectContaining({ clienteId: 'x2', recorridoId: 'marR', fija: false, solicitada: true, nota: 'Llamó', requiereConfirmacion: true }),
    ])
    expect(ruta(MARTES, [], asig, [visita('x2', MARTES, { confirmada: 'si' })]).pasarARetirar.map((p) => p.clienteId)).toEqual(['x2'])
    expect(ids(ruta(MARTES, [], asig, [visita('x2', MARTES, { confirmada: 'no' })]))).toEqual([])
    expect(ids(ruta(MARTES, [], asig, [visita('x2', MARTES, { confirmada: 'sin_respuesta' })]))).toEqual([])
    // una visita de otro día no lo agrega
    expect(ids(ruta(MARTES, [], asig, [visita('x2', LUNES, { solicitada: true })]))).toEqual([])
    // con algo listo y "no": sigue visible y marcado (el chofer decide)
    const f = fx('x2', 1)
    expect(ruta(MARTES, [f], asig, [visita('x2', MARTES, { confirmada: 'no' })]).paradas[0]).toMatchObject({ clienteId: 'x2', confirmada: 'no', entregar: [f] })
  })

  it('dentro de un recorrido se ordena por orden y luego por nombre (es)', () => {
    const asig = [fija('x3', 'lunR', 2), fija('x4', 'lunR', 2), fija('x1', 'lunR', 1), aPedido('x2', 'lunR', 0)]
    const r = ruta(LUNES, [fx('x3', 1), fx('x4', 1), fx('x1', 1), fx('x2', 1)], asig)
    expect(r.paradas.map((p) => [p.clienteNombre, p.orden])).toEqual([
      ['A Pedido Ltda', 0], ['Tres Días SpA', 1], ['Alfa Fija', 2], ['Beta Fija', 2],
    ])
    const vacia = ruta(LUNES, [], asig)
    expect(vacia.pasarARetirar.map((p) => p.clienteNombre)).toEqual(['Tres Días SpA', 'Alfa Fija', 'Beta Fija'])
  })

  it('cada recorrido del día es su propio grupo: los de Rodrigo y los de Angelo no se mezclan', () => {
    const r = ruta(LUNES, [], [fija('x3', 'lunR'), fija('x4', 'lunA')])
    expect(r.pasarARetirar.map((p) => [p.recorridoNombre, p.clienteNombre])).toEqual([
      ['Lunes · Angelo', 'Alfa Fija'], ['Lunes · Rodrigo Lagos', 'Beta Fija'],
    ])
  })

  it('en dos recorridos el MISMO día sale una sola vez: primero el fijo, luego el de menor orden, luego por nombre de recorrido; sin duplicar entregas', () => {
    const f = fx('x5', 2)
    // fijo gana aunque el otro tenga menor orden
    let r = ruta(LUNES, [f], [aPedido('x5', 'lunR', 0), fija('x5', 'lunA', 9)])
    expect(r.paradas).toEqual([expect.objectContaining({ clienteId: 'x5', recorridoId: 'lunA', fija: true, orden: 9, entregar: [f] })])
    expect(r.pasarARetirar).toEqual([])
    // ambos fijos: el de menor orden
    r = ruta(LUNES, [f], [fija('x5', 'lunA', 5), fija('x5', 'lunR', 1)])
    expect(r.paradas.map((p) => p.recorridoId)).toEqual(['lunR'])
    // mismo orden: por nombre del recorrido ("Lunes · Angelo" antes que "Lunes · Rodrigo Lagos")
    r = ruta(LUNES, [], [fija('x5', 'lunR', 1), fija('x5', 'lunA', 1)])
    expect(r.pasarARetirar.map((p) => p.recorridoId)).toEqual(['lunA'])
    // ambos a pedido y nada que entregar: no sale
    expect(ids(ruta(LUNES, [], [aPedido('x5', 'lunR'), aPedido('x5', 'lunA')]))).toEqual([])
  })

  it('una visita extra de un cliente asignado otro día va a "Visitas extra" (sin recorrido del día) con lo listo', () => {
    const f = fx('x1', 1)
    const r = ruta(MARTES, [f], [fija('x1', 'lunR'), fija('x1', 'vieA')], [visita('x1', MARTES, { solicitada: true })])
    expect(r.paradas).toEqual([expect.objectContaining({ clienteId: 'x1', recorridoId: null, fija: false, entregar: [f], requiereConfirmacion: false })])
  })

  it('"sin recorrido" es solo lo listo por ruta propia de clientes SIN ninguna asignación (o solo a recorridos borrados)', () => {
    const fNadie = fx('x6', 1)
    const fOtroDia = fx('x1', 1)
    const fBorrado = fx('x3', 1)
    const r = ruta(MARTES, [fNadie, fOtroDia, fBorrado], [fija('x1', 'lunR'), fija('x3', 'no-existe')])
    expect(r.sinRecorrido).toEqual([fBorrado, fNadie])
    expect(ids(r)).toEqual([])
  })

  it('fin de semana: no hay ruta aunque el cliente esté en todos los recorridos', () => {
    const r = ruta(SABADO, [fx('x1', 1)], semana.map((s) => fija('x1', s.id)), [visita('x1', SABADO, { solicitada: true })])
    expect(ids(r)).toEqual([])
    expect(r.sinRecorrido).toEqual([])
  })
})

describe('recorridoDelChofer', () => {
  const semana: Recorrido[] = [
    { id: 'lunR', nombre: 'Lunes · Rodrigo Lagos', dia: 1, camioneta: 'C1', lejano: false, chofer: 'Rodrigo Lagos' },
    { id: 'lunA', nombre: 'Lunes · Angelo', dia: 1, camioneta: 'C2', lejano: false, chofer: 'Ángelo' },
    { id: 'marA', nombre: 'Martes · Angelo', dia: 2, camioneta: 'C2', lejano: false, chofer: 'Angelo' },
    { id: 'mieX', nombre: 'Miércoles', dia: 3, camioneta: 'C2', lejano: false },
  ]
  it('elige el recorrido de ese día cuyo chofer coincide con el nombre (sin importar mayúsculas, tildes ni espacios)', () => {
    expect(recorridoDelChofer(semana, LUNES, '  angelo ')?.id).toBe('lunA')
    expect(recorridoDelChofer(semana, LUNES, 'RODRIGO  LAGOS')?.id).toBe('lunR')
    expect(recorridoDelChofer(semana, MARTES, 'Angelo')?.id).toBe('marA')
  })
  it('sin coincidencia, sin chofer anotado o en fin de semana: undefined', () => {
    expect(recorridoDelChofer(semana, MARTES, 'Rodrigo Lagos')).toBeUndefined()
    expect(recorridoDelChofer(semana, MIERCOLES, '')).toBeUndefined()
    expect(recorridoDelChofer(semana, SABADO, 'Angelo')).toBeUndefined()
  })
})
