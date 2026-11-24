import { describe, it, expect } from 'vitest'
import { resumenListo, type DatosOperacion } from './listo'
import type { Cliente, Etapa, Linea, Movimiento, Recorrido, Trabajo } from './tipos'

const etapas: Etapa[] = [
  { id: 'a1', area: 'afilado', orden: 1, nombre: 'Recibido', esListo: false, esFinal: false },
  { id: 'a2', area: 'afilado', orden: 2, nombre: 'Listo', esListo: true, esFinal: false },
  { id: 'a3', area: 'afilado', orden: 3, nombre: 'Entregado', esListo: false, esFinal: true },
  { id: 'b1', area: 'encuadernacion', orden: 1, nombre: 'Recibido', esListo: false, esFinal: false },
  { id: 'b2', area: 'encuadernacion', orden: 2, nombre: 'Listo', esListo: true, esFinal: false },
]
const recorridos: Recorrido[] = [{ id: 'r1', nombre: 'Norte', dia: 2, camioneta: 'C1', lejano: false }]
const clientes: Cliente[] = [
  { id: 'c1', nombre: 'Imprenta Sur', rut: '1-9', recorridoId: 'r1' },
  { id: 'c2', nombre: 'Sin Ruta SpA', rut: '2-7', recorridoId: null },
]
const trab = (id: string, numero: number, clienteId: string, area: Trabajo['area'] = 'afilado'): Trabajo => ({
  id, numero, clienteId, area, entrada: 'cliente', salida: 'cliente', recibidoEn: '2026-11-20T12:00:00Z', urgente: false,
})
const lin = (id: string, trabajoId: string, cantidad: number): Linea => ({ id, trabajoId, producto: 'X', cantidad })
let n = 0
const mov = (lineaId: string, cantidad: number, o: string | null, d: string, creadoEn: string): Movimiento => ({
  id: `m${n++}`, lineaId, cantidad, etapaOrigenId: o, etapaDestinoId: d, usuarioId: 'u', creadoEn,
})

function datos(p: Partial<DatosOperacion>): DatosOperacion {
  return { trabajos: [], lineas: [], movimientos: [], etapas, clientes, recorridos, ...p }
}

describe('resumenListo', () => {
  it('6 unidades, 4 listas: listas 4, total 6 y listoDesde = último movimiento hacia listo', () => {
    const r = resumenListo(datos({
      trabajos: [trab('t1', 7, 'c1')],
      lineas: [lin('l1', 't1', 6)],
      movimientos: [
        mov('l1', 6, null, 'a1', '2026-11-20T12:00:00Z'),
        mov('l1', 3, 'a1', 'a2', '2026-11-21T10:00:00Z'),
        mov('l1', 1, 'a1', 'a2', '2026-11-22T15:30:00Z'),
      ],
    }))
    expect(r).toEqual([{
      trabajoId: 't1', numero: 7, clienteNombre: 'Imprenta Sur', area: 'afilado', salida: 'cliente',
      listas: 4, total: 6, listoDesde: '2026-11-22T15:30:00Z', recorrido: 'Norte', dia: 2,
    }])
  })

  it('cliente sin recorrido aparece con recorrido y dia null', () => {
    const r = resumenListo(datos({
      trabajos: [trab('t1', 1, 'c2')], lineas: [lin('l1', 't1', 2)],
      movimientos: [mov('l1', 2, null, 'a1', '2026-11-20T12:00:00Z'), mov('l1', 2, 'a1', 'a2', '2026-11-21T12:00:00Z')],
    }))
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ clienteNombre: 'Sin Ruta SpA', recorrido: null, dia: null, listas: 2 })
  })

  it('trabajo sin unidades listas aparece con listas 0 y listoDesde null', () => {
    const r = resumenListo(datos({
      trabajos: [trab('t1', 1, 'c1', 'encuadernacion')], lineas: [lin('l1', 't1', 5)],
      movimientos: [mov('l1', 5, null, 'b1', '2026-11-20T12:00:00Z')],
    }))
    expect(r[0]).toMatchObject({ listas: 0, total: 5, listoDesde: null, area: 'encuadernacion' })
  })

  it('suma varias líneas y usa el movimiento a listo más reciente de todas', () => {
    const r = resumenListo(datos({
      trabajos: [trab('t1', 1, 'c1')], lineas: [lin('l1', 't1', 2), lin('l2', 't1', 3)],
      movimientos: [
        mov('l1', 2, null, 'a1', '2026-11-20T12:00:00Z'), mov('l2', 3, null, 'a1', '2026-11-20T12:00:00Z'),
        mov('l2', 3, 'a1', 'a2', '2026-11-21T09:00:00Z'), mov('l1', 1, 'a1', 'a2', '2026-11-23T09:00:00Z'),
      ],
    }))
    expect(r[0]).toMatchObject({ listas: 4, total: 5, listoDesde: '2026-11-23T09:00:00Z' })
  })

  it('un trabajo totalmente entregado no aparece; uno parcialmente entregado sí', () => {
    const r = resumenListo(datos({
      trabajos: [trab('t1', 1, 'c1'), trab('t2', 2, 'c1')],
      lineas: [lin('l1', 't1', 2), lin('l2', 't2', 4)],
      movimientos: [
        mov('l1', 2, null, 'a1', '2026-11-20T12:00:00Z'), mov('l1', 2, 'a1', 'a2', '2026-11-21T12:00:00Z'),
        mov('l1', 2, 'a2', 'a3', '2026-11-22T12:00:00Z'),
        mov('l2', 4, null, 'a1', '2026-11-20T12:00:00Z'), mov('l2', 4, 'a1', 'a2', '2026-11-21T12:00:00Z'),
        mov('l2', 1, 'a2', 'a3', '2026-11-22T12:00:00Z'),
      ],
    }))
    expect(r.map((f) => f.trabajoId)).toEqual(['t2'])
    expect(r[0]).toMatchObject({ listas: 3, total: 4 })
  })

  it('no falla con datos huérfanos (cliente inexistente, trabajo sin líneas, movimientos sin línea)', () => {
    const r = resumenListo(datos({
      trabajos: [trab('t1', 1, 'zzz'), trab('t2', 2, 'c1')],
      movimientos: [mov('fantasma', 1, null, 'a1', '2026-11-20T12:00:00Z')],
    }))
    expect(r).toHaveLength(2)
    expect(r[0].total).toBe(0)
    expect(r[0].recorrido).toBeNull()
  })
})
