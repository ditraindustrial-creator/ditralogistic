import { describe, it, expect } from 'vitest'
import { etiquetaHora, horaSantiago, reporteDiario } from './reporte'
import type { DatosOperacion } from './listo'
import type { Etapa, Linea, Movimiento, Trabajo } from './tipos'

const etapas: Etapa[] = [
  { id: 'e1', area: 'encuadernacion', orden: 1, nombre: 'Recibido', esListo: false, esFinal: false },
  { id: 'e2', area: 'encuadernacion', orden: 2, nombre: 'En producción', esListo: false, esFinal: false },
  { id: 'e3', area: 'encuadernacion', orden: 3, nombre: 'Terminado', esListo: true, esFinal: false },
  { id: 'e4', area: 'encuadernacion', orden: 4, nombre: 'Entregado', esListo: false, esFinal: true },
  { id: 'a1', area: 'afilado', orden: 1, nombre: 'Recibido', esListo: false, esFinal: false },
  { id: 'a2', area: 'afilado', orden: 2, nombre: 'Listo', esListo: true, esFinal: false },
]
const trab = (id: string, numero: number, area: Trabajo['area'] = 'encuadernacion', urgente = false): Trabajo => ({
  id, numero, clienteId: 'c1', area, entrada: 'cliente', salida: 'cliente', recibidoEn: '2026-11-20T12:00:00Z', urgente,
})
const lin = (id: string, trabajoId: string, cantidad: number, producto = 'Libro'): Linea => ({ id, trabajoId, producto, cantidad })
let n = 0
const mov = (lineaId: string, cantidad: number, o: string | null, d: string, creadoEn: string): Movimiento => ({
  id: `m${++n}`, lineaId, cantidad, etapaOrigenId: o, etapaDestinoId: d, usuarioId: 'u', creadoEn,
})
const datos = (p: Partial<DatosOperacion>): DatosOperacion => ({
  trabajos: [], lineas: [], movimientos: [], etapas, clientes: [{ id: 'c1', nombre: 'Imprenta Sur', rut: '1-9' }], recorridos: [], asignaciones: [], entregasPlanificadas: [], ...p,
})
const HOY = '2026-11-24'

describe('reporteDiario', () => {
  it('una línea que pasó a Terminado hoy aparece en listo con la hora de Santiago y en porEntregar', () => {
    const r = reporteDiario(HOY, datos({
      trabajos: [trab('t1', 5)], lineas: [lin('l1', 't1', 3)],
      movimientos: [mov('l1', 3, null, 'e1', '2026-11-20T12:00:00Z'), mov('l1', 3, 'e1', 'e3', '2026-11-24T13:15:00Z')],
    }))
    expect(r.listo).toMatchObject([{ clienteNombre: 'Imprenta Sur', trabajoNumero: 5, producto: 'Libro', cantidad: 3, hora: '10:15' }])
    expect(r.porEntregar).toMatchObject([{ trabajoNumero: 5, cantidad: 3, hora: '10:15' }])
    expect(r.enProduccion).toEqual([])
    expect(r.sinClasificar).toBe(0)
  })

  it('listo → atrás → listo el mismo día no cuenta doble (ida y vuelta de las mismas 3 unidades)', () => {
    const r = reporteDiario(HOY, datos({
      trabajos: [trab('t1', 5)], lineas: [lin('l1', 't1', 3)],
      movimientos: [
        mov('l1', 3, null, 'e1', '2026-11-20T12:00:00Z'),
        mov('l1', 3, 'e1', 'e3', '2026-11-24T12:00:00Z'),
        mov('l1', 3, 'e3', 'e2', '2026-11-24T13:00:00Z'), // se devolvieron para corregir
        mov('l1', 3, 'e2', 'e3', '2026-11-24T14:00:00Z'),
      ],
    }))
    expect(r.listo).toMatchObject([{ cantidad: 3, hora: '11:00' }])
    expect(r.porEntregar).toMatchObject([{ cantidad: 3 }])
  })

  it('el conteo de listo hoy nunca supera la cantidad de la línea, y lo entregado hoy sigue contando como listo hoy', () => {
    const r = reporteDiario(HOY, datos({
      trabajos: [trab('t1', 5)], lineas: [lin('l1', 't1', 2)],
      movimientos: [
        mov('l1', 2, null, 'e1', '2026-11-20T12:00:00Z'),
        mov('l1', 2, 'e1', 'e3', '2026-11-24T12:00:00Z'),
        mov('l1', 2, 'e3', 'e4', '2026-11-24T12:30:00Z'), // entregadas
        mov('l1', 2, 'e4', 'e2', '2026-11-24T13:00:00Z'), // corrección: vuelven a producción
        mov('l1', 2, 'e2', 'e3', '2026-11-24T14:00:00Z'),
      ],
    }))
    expect(r.listo).toMatchObject([{ cantidad: 2 }])
  })

  it('si lo que quedó listo hoy se devolvió y no volvió, no aparece en listo hoy', () => {
    const r = reporteDiario(HOY, datos({
      trabajos: [trab('t1', 5)], lineas: [lin('l1', 't1', 4)],
      movimientos: [
        mov('l1', 4, null, 'e1', '2026-11-20T12:00:00Z'),
        mov('l1', 4, 'e1', 'e3', '2026-11-24T12:00:00Z'),
        mov('l1', 1, 'e3', 'e2', '2026-11-24T13:00:00Z'),
      ],
    }))
    expect(r.listo).toMatchObject([{ cantidad: 3 }])
    expect(r.enProduccion).toMatchObject([{ cantidad: 1 }])
  })

  it('una línea en producción aparece en enProduccion con la hora del último movimiento que la puso ahí', () => {
    const r = reporteDiario(HOY, datos({
      trabajos: [trab('t1', 5)], lineas: [lin('l1', 't1', 4)],
      movimientos: [mov('l1', 4, null, 'e1', '2026-11-20T12:00:00Z'), mov('l1', 2, 'e1', 'e2', '2026-11-24T11:00:00Z'), mov('l1', 2, 'e1', 'e2', '2026-11-24T12:20:00Z')],
    }))
    expect(r.enProduccion).toMatchObject([{ cantidad: 4, hora: '09:20' }])
    expect(r.listo).toEqual([])
    expect(r.porEntregar).toEqual([])
  })

  it('lo recibido y sin empezar va a la lista informativa "recibido"', () => {
    const r = reporteDiario(HOY, datos({
      trabajos: [trab('t1', 5)], lineas: [lin('l1', 't1', 4)], movimientos: [mov('l1', 4, null, 'e1', '2026-11-24T12:00:00Z')],
    }))
    expect(r.recibido).toMatchObject([{ cantidad: 4, hora: '09:00' }])
    expect(r.enProduccion).toEqual([])
  })

  it('las líneas de afilado nunca aparecen', () => {
    const r = reporteDiario(HOY, datos({
      trabajos: [trab('t1', 5, 'afilado')], lineas: [lin('l1', 't1', 2)],
      movimientos: [mov('l1', 2, null, 'a1', '2026-11-24T12:00:00Z'), mov('l1', 2, 'a1', 'a2', '2026-11-24T13:00:00Z')],
    }))
    expect(r).toEqual({ listo: [], enProduccion: [], porEntregar: [], recibido: [], sinClasificar: 0 })
  })

  it('un movimiento a las 02:30Z de noviembre (UTC-3) cuenta como el 24; uno de julio a las 03:30Z (UTC-4) como el 1', () => {
    const base = { trabajos: [trab('t1', 5)], lineas: [lin('l1', 't1', 1)] }
    const verano = datos({ ...base, movimientos: [mov('l1', 1, null, 'e1', '2026-11-20T12:00:00Z'), mov('l1', 1, 'e1', 'e3', '2026-11-25T02:30:00Z')] })
    expect(reporteDiario('2026-11-24', verano).listo).toMatchObject([{ hora: '23:30' }])
    expect(reporteDiario('2026-11-25', verano).listo).toEqual([])
    const invierno = datos({ ...base, movimientos: [mov('l1', 1, null, 'e1', '2026-06-30T12:00:00Z'), mov('l1', 1, 'e1', 'e3', '2026-07-02T03:30:00Z')] })
    expect(reporteDiario('2026-07-01', invierno).listo).toMatchObject([{ hora: '23:30' }])
    expect(reporteDiario('2026-07-02', invierno).listo).toEqual([])
  })

  it('un reporte de ayer no incluye movimientos de hoy y es estable', () => {
    const d = datos({
      trabajos: [trab('t1', 5)], lineas: [lin('l1', 't1', 3)],
      movimientos: [mov('l1', 3, null, 'e1', '2026-11-20T12:00:00Z'), mov('l1', 3, 'e1', 'e2', '2026-11-23T14:00:00Z'), mov('l1', 3, 'e2', 'e3', '2026-11-24T13:00:00Z')],
    })
    const ayer = reporteDiario('2026-11-23', d)
    expect(ayer.listo).toEqual([])
    expect(ayer.porEntregar).toEqual([])
    expect(ayer.enProduccion).toMatchObject([{ cantidad: 3, hora: '11:00' }])
  })

  it('un día vacío devuelve las listas vacías, no un error', () => {
    expect(reporteDiario(HOY, datos({}))).toEqual({ listo: [], enProduccion: [], porEntregar: [], recibido: [], sinClasificar: 0 })
  })

  it('porEntregar incluye lo que quedó listo otros días, con su instante; listo solo lo de la fecha', () => {
    const r = reporteDiario(HOY, datos({
      trabajos: [trab('t1', 5)], lineas: [lin('l1', 't1', 2)],
      movimientos: [mov('l1', 2, null, 'e1', '2026-11-20T12:00:00Z'), mov('l1', 2, 'e1', 'e3', '2026-11-23T19:40:00Z')],
    }))
    expect(r.listo).toEqual([])
    expect(r.porEntregar).toMatchObject([{ cantidad: 2, hora: '16:40', dia: '2026-11-23' }])
  })

  it('línea parcial de 6: 2 entregadas, 3 listas y 1 en producción da filas separadas', () => {
    const r = reporteDiario(HOY, datos({
      trabajos: [trab('t1', 5)], lineas: [lin('l1', 't1', 6)],
      movimientos: [
        mov('l1', 6, null, 'e1', '2026-11-20T12:00:00Z'),
        mov('l1', 6, 'e1', 'e2', '2026-11-21T12:00:00Z'),
        mov('l1', 5, 'e2', 'e3', '2026-11-22T12:00:00Z'),
        mov('l1', 2, 'e3', 'e4', '2026-11-23T12:00:00Z'),
      ],
    }))
    expect(r.porEntregar).toMatchObject([{ cantidad: 3 }])
    expect(r.enProduccion).toMatchObject([{ cantidad: 1 }])
  })

  it('lo totalmente entregado queda fuera de enProduccion y porEntregar', () => {
    const r = reporteDiario(HOY, datos({
      trabajos: [trab('t1', 5)], lineas: [lin('l1', 't1', 2)],
      movimientos: [mov('l1', 2, null, 'e1', '2026-11-20T12:00:00Z'), mov('l1', 2, 'e1', 'e3', '2026-11-24T12:00:00Z'), mov('l1', 2, 'e3', 'e4', '2026-11-24T15:00:00Z')],
    }))
    expect(r.porEntregar).toEqual([])
    expect(r.enProduccion).toEqual([])
    expect(r.listo).toMatchObject([{ cantidad: 2 }]) // igual quedó listo ese día
  })

  it('varias líneas del mismo trabajo son filas separadas', () => {
    const r = reporteDiario(HOY, datos({
      trabajos: [trab('t1', 5)], lineas: [lin('l1', 't1', 1, 'Libro'), lin('l2', 't1', 2, 'Cuaderno')],
      movimientos: [
        mov('l1', 1, null, 'e2', '2026-11-24T12:00:00Z'),
        mov('l2', 2, null, 'e2', '2026-11-24T13:00:00Z'),
      ],
    }))
    expect(r.enProduccion.map((f) => [f.producto, f.cantidad])).toEqual([['Libro', 1], ['Cuaderno', 2]])
  })

  it('ordena lo más antiguo primero y los urgentes antes', () => {
    const r = reporteDiario(HOY, datos({
      trabajos: [trab('t1', 1), trab('t2', 2), trab('t3', 3, 'encuadernacion', true)],
      lineas: [lin('l1', 't1', 1), lin('l2', 't2', 1), lin('l3', 't3', 1)],
      movimientos: [
        mov('l1', 1, null, 'e2', '2026-11-24T15:00:00Z'),
        mov('l2', 1, null, 'e2', '2026-11-24T12:00:00Z'),
        mov('l3', 1, null, 'e2', '2026-11-24T16:00:00Z'),
      ],
    }))
    expect(r.enProduccion.map((f) => f.trabajoNumero)).toEqual([3, 2, 1])
  })

  it('ignora sin romper las líneas con etapas desconocidas y las cuenta en sinClasificar', () => {
    const r = reporteDiario(HOY, datos({
      trabajos: [trab('t1', 1), trab('t2', 2)], lineas: [lin('l1', 't1', 1), lin('l2', 't2', 1)],
      movimientos: [mov('l1', 1, null, 'zzz', '2026-11-24T12:00:00Z'), mov('l2', 1, null, 'e2', '2026-11-24T12:00:00Z')],
    }))
    expect(r.sinClasificar).toBe(1)
    expect(r.enProduccion.map((f) => f.trabajoNumero)).toEqual([2])
  })

  it('maneja miles de movimientos', () => {
    const trabajos: Trabajo[] = []
    const lineas: Linea[] = []
    const movimientos: Movimiento[] = []
    for (let i = 0; i < 3000; i++) {
      trabajos.push(trab(`t${i}`, i)); lineas.push(lin(`l${i}`, `t${i}`, 2))
      movimientos.push(mov(`l${i}`, 2, null, 'e1', '2026-11-20T12:00:00Z'), mov(`l${i}`, 2, 'e1', 'e2', '2026-11-24T12:00:00Z'))
    }
    expect(reporteDiario(HOY, datos({ trabajos, lineas, movimientos })).enProduccion).toHaveLength(3000)
  })
})

describe('horaSantiago y etiquetaHora', () => {
  it('formatea HH:mm en Santiago', () => {
    expect(horaSantiago('2026-11-24T13:15:00Z')).toBe('10:15')
    expect(horaSantiago('2026-07-02T03:30:00Z')).toBe('23:30')
  })
  it('sin día cuando es la fecha; "ayer", día de la semana o fecha en otros casos', () => {
    expect(etiquetaHora('2026-11-24', '2026-11-24', '10:15')).toBe('10:15')
    expect(etiquetaHora('2026-11-23', '2026-11-24', '16:40')).toBe('ayer 16:40')
    expect(etiquetaHora('2026-11-23', '2026-11-27', '16:40')).toBe('lun 16:40')
    expect(etiquetaHora('2026-11-10', '2026-11-24', '16:40')).toBe('10/11 16:40')
  })
})
