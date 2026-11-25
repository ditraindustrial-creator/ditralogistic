import { describe, it, expect } from 'vitest'
import {
  agregarDocumento,
  ErrorEntrega,
  planificarEntrega,
  unidadesListasPorLinea,
  lineasEntregables,
  type DatosEntrega,
} from './entrega'
import type { Etapa, Linea, Movimiento, Trabajo } from './tipos'

const etapas: Etapa[] = [
  { id: 'a1', area: 'afilado', orden: 1, nombre: 'Recibido', esListo: false, esFinal: false },
  { id: 'a2', area: 'afilado', orden: 2, nombre: 'Listo', esListo: true, esFinal: false },
  { id: 'a3', area: 'afilado', orden: 3, nombre: 'Listo en bodega 2', esListo: true, esFinal: false },
  { id: 'a4', area: 'afilado', orden: 4, nombre: 'Entregado', esListo: false, esFinal: true },
  { id: 'b1', area: 'encuadernacion', orden: 1, nombre: 'Recibido', esListo: false, esFinal: false },
  { id: 'b2', area: 'encuadernacion', orden: 2, nombre: 'Terminado', esListo: true, esFinal: false },
]
const trab = (id: string, area: Trabajo['area'] = 'afilado', guiaDespacho?: string): Trabajo => ({
  id, numero: 1, clienteId: 'c1', area, entrada: 'ruta_propia', salida: 'ruta_propia', recibidoEn: '2026-11-20T12:00:00Z',
  urgente: false, ...(guiaDespacho ? { guiaDespacho } : {}),
})
const lin = (id: string, trabajoId: string, cantidad: number, producto = 'Cuchillo'): Linea => ({ id, trabajoId, producto, cantidad })
let n = 0
const mov = (lineaId: string, cantidad: number, o: string | null, d: string): Movimiento => ({
  id: `m${n++}`, lineaId, cantidad, etapaOrigenId: o, etapaDestinoId: d, usuarioId: 'u', creadoEn: '2026-11-20T12:00:00Z',
})

function datos(): DatosEntrega {
  return {
    etapas,
    trabajos: [trab('t1'), trab('t2', 'afilado', '100'), trab('t3', 'encuadernacion')],
    lineas: [lin('l1', 't1', 4), lin('l2', 't1', 5, 'Tijera'), lin('l3', 't2', 2), lin('l4', 't3', 1, 'Libro')],
    movimientos: [
      // l1: 4 recibidas, 4 listas
      mov('l1', 4, null, 'a1'), mov('l1', 4, 'a1', 'a2'),
      // l2: 5 recibidas, 2 en Listo y 1 en "Listo en bodega 2", 2 aún en Recibido
      mov('l2', 5, null, 'a1'), mov('l2', 2, 'a1', 'a2'), mov('l2', 1, 'a1', 'a3'),
      // l3: 2 listas
      mov('l3', 2, null, 'a1'), mov('l3', 2, 'a1', 'a2'),
      // l4: encuadernación sin etapa final configurada
      mov('l4', 1, null, 'b1'), mov('l4', 1, 'b1', 'b2'),
    ],
  }
}
const error = (f: () => unknown) => {
  try {
    f()
  } catch (e) {
    expect(e).toBeInstanceOf(ErrorEntrega)
    return (e as Error).message
  }
  throw new Error('no lanzó error')
}

describe('planificarEntrega', () => {
  it('entregar 3 de 4 listas: un movimiento de Listo a Entregado y el documento en la guía', () => {
    const plan = planificarEntrega(datos(), [{ lineaId: 'l1', cantidad: 3 }], ' 4521 ')
    expect(plan.movimientos).toEqual([{ lineaId: 'l1', cantidad: 3, etapaOrigenId: 'a2', etapaDestinoId: 'a4' }])
    expect(plan.guias).toEqual([{ trabajoId: 't1', guiaDespacho: '4521' }])
  })

  it('varias líneas y varias etapas "listo": toma por orden de etapa y procesa las líneas en orden de id', () => {
    const plan = planificarEntrega(datos(), [{ lineaId: 'l3', cantidad: 2 }, { lineaId: 'l2', cantidad: 3 }], 'F-77')
    expect(plan.movimientos).toEqual([
      { lineaId: 'l2', cantidad: 2, etapaOrigenId: 'a2', etapaDestinoId: 'a4' },
      { lineaId: 'l2', cantidad: 1, etapaOrigenId: 'a3', etapaDestinoId: 'a4' },
      { lineaId: 'l3', cantidad: 2, etapaOrigenId: 'a2', etapaDestinoId: 'a4' },
    ])
    expect(plan.guias).toEqual([
      { trabajoId: 't1', guiaDespacho: 'F-77' },
      { trabajoId: 't2', guiaDespacho: '100, F-77' },
    ])
  })

  it('no entrega más de lo listo: dice cuánto falta (las unidades que no están listas no cuentan)', () => {
    expect(error(() => planificarEntrega(datos(), [{ lineaId: 'l2', cantidad: 4 }], '1'))).toBe(
      '«Tijera» tiene 3 unidades listas; no se pueden entregar 4 (faltan 1).',
    )
    const d = datos()
    d.movimientos.push(mov('l3', 1, 'a2', 'a4'))
    expect(error(() => planificarEntrega(d, [{ lineaId: 'l3', cantidad: 2 }], '1'))).toBe(
      '«Cuchillo» tiene 1 unidad lista; no se pueden entregar 2 (faltan 1).',
    )
  })

  it('valida la entrada con mensajes en español, antes de mirar las líneas', () => {
    const d = datos()
    expect(error(() => planificarEntrega(d, [], '1'))).toBe('Indica qué entregar.')
    expect(error(() => planificarEntrega(d, [{ lineaId: '', cantidad: 1 }], '1'))).toBe('Falta la línea a entregar.')
    for (const cantidad of [0, -1, 1.5, Number.NaN, 2147483648]) {
      expect(error(() => planificarEntrega(d, [{ lineaId: 'l1', cantidad }], '1'))).toBe(
        'La cantidad a entregar debe ser un número entero mayor que cero.',
      )
    }
    expect(error(() => planificarEntrega(d, [{ lineaId: 'l1', cantidad: 1 }, { lineaId: 'l1', cantidad: 1 }], '1'))).toBe(
      'No repitas la misma línea en una entrega.',
    )
    expect(error(() => planificarEntrega(d, [{ lineaId: 'l1', cantidad: 1 }], '   '))).toBe('Anota el número de guía o factura.')
    expect(error(() => planificarEntrega(d, [{ lineaId: 'l1', cantidad: 1 }], 'x'.repeat(41)))).toBe(
      'El número de documento puede tener hasta 40 caracteres.',
    )
    expect(error(() => planificarEntrega(d, [{ lineaId: 'l1', cantidad: 1 }], '1, 2'))).toBe(
      'El número de documento no puede llevar comas.',
    )
  })

  it('línea inexistente y área sin etapa final', () => {
    expect(error(() => planificarEntrega(datos(), [{ lineaId: 'zz', cantidad: 1 }], '1'))).toBe('La línea no existe.')
    expect(error(() => planificarEntrega(datos(), [{ lineaId: 'l4', cantidad: 1 }], '1'))).toBe(
      'El área no tiene una etapa de entrega configurada.',
    )
  })

  it('si una línea falla no se planifica nada (todo o nada)', () => {
    expect(() => planificarEntrega(datos(), [{ lineaId: 'l1', cantidad: 1 }, { lineaId: 'l3', cantidad: 9 }], '1')).toThrow(
      ErrorEntrega,
    )
  })
})

describe('agregarDocumento', () => {
  it('agrega con ", " sin repetir un número que ya está', () => {
    expect(agregarDocumento(undefined, '4521')).toBe('4521')
    expect(agregarDocumento('  ', '4521')).toBe('4521')
    expect(agregarDocumento('100', '4521')).toBe('100, 4521')
    expect(agregarDocumento('100, 4521', '4521')).toBe('100, 4521')
    expect(agregarDocumento('100,4521', '4521')).toBe('100,4521')
    expect(agregarDocumento('14521', '4521')).toBe('14521, 4521')
  })
})

describe('unidadesListasPorLinea', () => {
  const etapas: Etapa[] = [
    { id: 'e1', area: 'afilado', orden: 1, nombre: 'Recibido', esListo: false, esFinal: false },
    { id: 'e2', area: 'afilado', orden: 2, nombre: 'Listo', esListo: true, esFinal: false },
    { id: 'e3', area: 'afilado', orden: 3, nombre: 'Entregado', esListo: false, esFinal: true },
  ]
  const m = (id: string, lineaId: string, cantidad: number, o: string | null, d: string): Movimiento => ({
    id, lineaId, cantidad, etapaOrigenId: o, etapaDestinoId: d, usuarioId: 'u', creadoEn: '2026-11-20T12:00:00Z',
  })
  const datos = {
    trabajos: [{ id: 't1', numero: 1, clienteId: 'c', area: 'afilado', entrada: 'cliente', salida: 'ruta_propia', recibidoEn: '2026-11-20T12:00:00Z', urgente: false }] as Trabajo[],
    lineas: [
      { id: 'l1', trabajoId: 't1', producto: 'Cuchillo', cantidad: 6 },
      { id: 'l2', trabajoId: 't1', producto: 'Tijera', cantidad: 2 },
    ],
    etapas,
    movimientos: [m('1', 'l1', 6, null, 'e1'), m('2', 'l1', 4, 'e1', 'e2'), m('3', 'l1', 1, 'e2', 'e3'), m('4', 'l2', 2, null, 'e1')],
  }
  it('cuenta solo las unidades que están hoy en una etapa listo, por línea, y omite las líneas sin listas', () => {
    expect(unidadesListasPorLinea(datos, 't1')).toEqual([{ lineaId: 'l1', producto: 'Cuchillo', listas: 3 }])
  })
  it('un trabajo desconocido no tiene líneas', () => {
    expect(unidadesListasPorLinea(datos, 'zz')).toEqual([])
  })
})

describe('lineasEntregables', () => {
  const etapas: Etapa[] = [
    { id: 'e1', area: 'afilado', orden: 1, nombre: 'Recibido', esListo: false, esFinal: false },
    { id: 'e2', area: 'afilado', orden: 2, nombre: 'Listo', esListo: true, esFinal: false },
    { id: 'e3', area: 'afilado', orden: 3, nombre: 'Entregado', esListo: false, esFinal: true },
  ]
  const t = (id: string, numero: number): Trabajo => ({ id, numero, clienteId: 'c', area: 'afilado', entrada: 'cliente', salida: 'ruta_propia', recibidoEn: '2026-11-20T12:00:00Z', urgente: false })
  const m = (id: string, lineaId: string, cantidad: number, o: string | null, d: string): Movimiento => ({
    id, lineaId, cantidad, etapaOrigenId: o, etapaDestinoId: d, usuarioId: 'u', creadoEn: '2026-11-20T12:00:00Z',
  })
  it('junta las líneas con unidades listas de varios trabajos, con su número, en el orden pedido', () => {
    const datos = {
      trabajos: [t('t1', 11), t('t2', 12)],
      lineas: [
        { id: 'l1', trabajoId: 't1', producto: 'Cuchillo', cantidad: 4 },
        { id: 'l2', trabajoId: 't2', producto: 'Tijera', cantidad: 2 },
        { id: 'l3', trabajoId: 't2', producto: 'Sierra', cantidad: 2 },
      ],
      etapas,
      movimientos: [m('1', 'l1', 4, null, 'e2'), m('2', 'l2', 2, null, 'e2'), m('3', 'l3', 2, null, 'e1')],
    }
    expect(lineasEntregables(datos, ['t2', 't1'])).toEqual([
      { lineaId: 'l2', trabajoId: 't2', numero: 12, producto: 'Tijera', listas: 2 },
      { lineaId: 'l1', trabajoId: 't1', numero: 11, producto: 'Cuchillo', listas: 4 },
    ])
  })
})
