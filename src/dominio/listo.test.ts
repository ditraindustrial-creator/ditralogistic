import { describe, it, expect } from 'vitest'
import { resumenListo, type DatosOperacion } from './listo'
import { diaLocal } from './fechas'
import type { Asignacion, Cliente, Etapa, Linea, Movimiento, Recorrido, Trabajo } from './tipos'

const etapas: Etapa[] = [
  { id: 'a1', area: 'afilado', orden: 1, nombre: 'Recibido', esListo: false, esFinal: false },
  { id: 'a2', area: 'afilado', orden: 2, nombre: 'Listo', esListo: true, esFinal: false },
  { id: 'a3', area: 'afilado', orden: 3, nombre: 'Entregado', esListo: false, esFinal: true },
  { id: 'b1', area: 'encuadernacion', orden: 1, nombre: 'Recibido', esListo: false, esFinal: false },
  { id: 'b2', area: 'encuadernacion', orden: 2, nombre: 'Listo', esListo: true, esFinal: false },
]
const recorridos: Recorrido[] = [{ id: 'r1', nombre: 'Norte', dia: 2, camioneta: 'C1', lejano: false }]
const clientes: Cliente[] = [
  { id: 'c1', nombre: 'Imprenta Sur', rut: '1-9' },
  { id: 'c2', nombre: 'Sin Ruta SpA', rut: '2-7' },
]
const asignaciones: Asignacion[] = [{ clienteId: 'c1', recorridoId: 'r1', fija: true, orden: 0 }]
// 2026-11-23 es lunes.
const HOY = '2026-11-23'
const trab = (id: string, numero: number, clienteId: string, area: Trabajo['area'] = 'afilado'): Trabajo => ({
  id, numero, numeroArea: numero, clienteId, area, entrada: 'cliente', salida: 'cliente', recibidoEn: '2026-11-20T12:00:00Z', urgente: false,
})
const lin = (id: string, trabajoId: string, cantidad: number): Linea => ({ id, trabajoId, producto: 'X', cantidad })
let n = 0
const mov = (lineaId: string, cantidad: number, o: string | null, d: string, creadoEn: string): Movimiento => ({
  id: `m${n++}`, lineaId, cantidad, etapaOrigenId: o, etapaDestinoId: d, usuarioId: 'u', creadoEn,
})

function datos(p: Partial<DatosOperacion>): DatosOperacion {
  return { trabajos: [], lineas: [], movimientos: [], etapas, clientes, recorridos, asignaciones, ...p }
}

const resumen = (d: DatosOperacion, hoy = HOY) => resumenListo(d, hoy)

describe('resumenListo', () => {
  it('6 unidades, 4 listas: listas 4, total 6 y listoDesde = último movimiento hacia listo', () => {
    const r = resumen(datos({
      trabajos: [trab('t1', 7, 'c1')],
      lineas: [lin('l1', 't1', 6)],
      movimientos: [
        mov('l1', 6, null, 'a1', '2026-11-20T12:00:00Z'),
        mov('l1', 3, 'a1', 'a2', '2026-11-21T10:00:00Z'),
        mov('l1', 1, 'a1', 'a2', '2026-11-22T15:30:00Z'),
      ],
    }))
    expect(r).toEqual([{
      trabajoId: 't1', numero: 7, codigo: 'A-007', recibidoEn: '2026-11-20T12:00:00Z', clienteId: 'c1', clienteNombre: 'Imprenta Sur', area: 'afilado', salida: 'cliente',
      listas: 4, total: 6, entregadas: 0, pendientes: 6, listoDesde: '2026-11-22T15:30:00Z',
      rutas: [{ recorridoId: 'r1', recorridoNombre: 'Norte', dia: 2 }],
      proximaRuta: { recorridoId: 'r1', recorridoNombre: 'Norte', dia: 2, fecha: '2026-11-24' },
    }])
  })

  it('cliente sin recorrido aparece sin rutas y con proximaRuta null', () => {
    const r = resumen(datos({
      trabajos: [trab('t1', 1, 'c2')], lineas: [lin('l1', 't1', 2)],
      movimientos: [mov('l1', 2, null, 'a1', '2026-11-20T12:00:00Z'), mov('l1', 2, 'a1', 'a2', '2026-11-21T12:00:00Z')],
    }))
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ clienteNombre: 'Sin Ruta SpA', rutas: [], proximaRuta: null, listas: 2 })
  })

  it('trabajo sin unidades listas aparece con listas 0 y listoDesde null', () => {
    const r = resumen(datos({
      trabajos: [trab('t1', 1, 'c1', 'encuadernacion')], lineas: [lin('l1', 't1', 5)],
      movimientos: [mov('l1', 5, null, 'b1', '2026-11-20T12:00:00Z')],
    }))
    expect(r[0]).toMatchObject({ listas: 0, total: 5, listoDesde: null, area: 'encuadernacion' })
  })

  it('suma varias líneas y usa el movimiento a listo más reciente de todas', () => {
    const r = resumen(datos({
      trabajos: [trab('t1', 1, 'c1')], lineas: [lin('l1', 't1', 2), lin('l2', 't1', 3)],
      movimientos: [
        mov('l1', 2, null, 'a1', '2026-11-20T12:00:00Z'), mov('l2', 3, null, 'a1', '2026-11-20T12:00:00Z'),
        mov('l2', 3, 'a1', 'a2', '2026-11-21T09:00:00Z'), mov('l1', 1, 'a1', 'a2', '2026-11-23T09:00:00Z'),
      ],
    }))
    expect(r[0]).toMatchObject({ listas: 4, total: 5, listoDesde: '2026-11-23T09:00:00Z' })
  })

  it('un trabajo totalmente entregado no aparece; uno parcialmente entregado sí', () => {
    const r = resumen(datos({
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
    expect(r[0]).toMatchObject({ listas: 3, total: 4, entregadas: 1, pendientes: 3 })
  })

  it('no falla con datos huérfanos (cliente inexistente, trabajo sin líneas, movimientos sin línea)', () => {
    const r = resumen(datos({
      trabajos: [trab('t1', 1, 'zzz'), trab('t2', 2, 'c1')],
      movimientos: [mov('fantasma', 1, null, 'a1', '2026-11-20T12:00:00Z')],
    }))
    expect(r).toHaveLength(2)
    expect(r[0].total).toBe(0)
    expect(r[0].proximaRuta).toBeNull()
  })

  it('entregas parciales: 6 pedidas, 2 entregadas y 4 listas -> 4 de 4 pendientes', () => {
    const r = resumen(datos({
      trabajos: [trab('t1', 1, 'c1')], lineas: [lin('l1', 't1', 6)],
      movimientos: [
        mov('l1', 6, null, 'a1', '2026-11-20T12:00:00Z'), mov('l1', 6, 'a1', 'a2', '2026-11-21T12:00:00Z'),
        mov('l1', 2, 'a2', 'a3', '2026-11-22T12:00:00Z'),
      ],
    }))
    expect(r[0]).toMatchObject({ listas: 4, total: 6, entregadas: 2, pendientes: 4 })
  })

  it('entregas parciales: 4 entregadas y 2 aún en taller -> 0 de 2 pendientes', () => {
    const r = resumen(datos({
      trabajos: [trab('t1', 1, 'c1')], lineas: [lin('l1', 't1', 6)],
      movimientos: [
        mov('l1', 6, null, 'a1', '2026-11-20T12:00:00Z'), mov('l1', 4, 'a1', 'a2', '2026-11-21T12:00:00Z'),
        mov('l1', 4, 'a2', 'a3', '2026-11-22T12:00:00Z'),
      ],
    }))
    expect(r[0]).toMatchObject({ listas: 0, total: 6, entregadas: 4, pendientes: 2, listoDesde: null })
  })

  it('entregas parciales: 2 entregadas y todo lo que queda listo -> listas = pendientes', () => {
    const r = resumen(datos({
      trabajos: [trab('t1', 1, 'c1')], lineas: [lin('l1', 't1', 6)],
      movimientos: [
        mov('l1', 6, null, 'a1', '2026-11-20T12:00:00Z'), mov('l1', 2, 'a1', 'a3', '2026-11-21T12:00:00Z'),
        mov('l1', 4, 'a1', 'a2', '2026-11-22T12:00:00Z'),
      ],
    }))
    expect(r[0]).toMatchObject({ listas: 4, pendientes: 4, entregadas: 2 })
  })
})

describe('resumenListo: varios recorridos y próxima ruta (Task 10)', () => {
  const semana: Recorrido[] = [
    { id: 'vieA', nombre: 'Viernes · Angelo', dia: 5, camioneta: 'C2', lejano: false, chofer: 'Angelo' },
    { id: 'lunR', nombre: 'Lunes · Rodrigo Lagos', dia: 1, camioneta: 'C1', lejano: false, chofer: 'Rodrigo Lagos' },
    { id: 'mieR', nombre: 'Miércoles · Rodrigo Lagos', dia: 3, camioneta: 'C1', lejano: false },
    { id: 'mieA', nombre: 'Miércoles · Angelo', dia: 3, camioneta: 'C2', lejano: false },
  ]
  const asig: Asignacion[] = [
    { clienteId: 'c1', recorridoId: 'vieA', fija: true, orden: 0 },
    { clienteId: 'c1', recorridoId: 'mieR', fija: false, orden: 0 },
    { clienteId: 'c1', recorridoId: 'lunR', fija: true, orden: 3 },
    { clienteId: 'c1', recorridoId: 'borrado', fija: true, orden: 0 },
  ]
  const base = (hoy: string, a: Asignacion[] = asig) =>
    resumenListo({ trabajos: [trab('t1', 1, 'c1'), trab('t2', 2, 'c2')], lineas: [], movimientos: [], etapas, clientes, recorridos: semana, asignaciones: a }, hoy)

  it('rutas: todas las asignaciones del cliente, de lunes a viernes (las de recorridos borrados no cuentan)', () => {
    expect(base('2026-11-23')[0].rutas).toEqual([
      { recorridoId: 'lunR', recorridoNombre: 'Lunes · Rodrigo Lagos', dia: 1 },
      { recorridoId: 'mieR', recorridoNombre: 'Miércoles · Rodrigo Lagos', dia: 3 },
      { recorridoId: 'vieA', recorridoNombre: 'Viernes · Angelo', dia: 5 },
    ])
  })

  it('proximaRuta: el mismo día cuenta (hoy es día de ruta), y si no el siguiente día de ruta', () => {
    expect(base('2026-11-23')[0].proximaRuta).toEqual({ recorridoId: 'lunR', recorridoNombre: 'Lunes · Rodrigo Lagos', dia: 1, fecha: '2026-11-23' })
    expect(base('2026-11-24')[0].proximaRuta).toEqual({ recorridoId: 'mieR', recorridoNombre: 'Miércoles · Rodrigo Lagos', dia: 3, fecha: '2026-11-25' })
    expect(base('2026-11-25')[0].proximaRuta?.fecha).toBe('2026-11-25')
    expect(base('2026-11-26')[0].proximaRuta).toMatchObject({ recorridoId: 'vieA', fecha: '2026-11-27' })
  })

  it('proximaRuta pasa el fin de semana: viernes después de su ruta -> lunes; sábado y domingo -> lunes', () => {
    const soloLunes: Asignacion[] = [{ clienteId: 'c1', recorridoId: 'lunR', fija: true, orden: 0 }]
    expect(base('2026-11-27', soloLunes)[0].proximaRuta).toMatchObject({ dia: 1, fecha: '2026-11-30' })
    expect(base('2026-11-28', soloLunes)[0].proximaRuta).toMatchObject({ dia: 1, fecha: '2026-11-30' })
    expect(base('2026-11-29', soloLunes)[0].proximaRuta).toMatchObject({ dia: 1, fecha: '2026-11-30' })
    // fin de mes y de año
    expect(base('2026-12-31', soloLunes)[0].proximaRuta?.fecha).toBe('2027-01-04')
    // solo viernes, consultado un lunes: el viernes de esa semana
    const soloViernes: Asignacion[] = [{ clienteId: 'c1', recorridoId: 'vieA', fija: true, orden: 0 }]
    expect(base('2026-11-23', soloViernes)[0].proximaRuta?.fecha).toBe('2026-11-27')
    // un sábado, el viernes siguiente (6 días después)
    expect(base('2026-11-28', soloViernes)[0].proximaRuta?.fecha).toBe('2026-12-04')
  })

  it('dos recorridos el mismo día: gana el de menor orden y luego el nombre del recorrido', () => {
    const dos: Asignacion[] = [
      { clienteId: 'c1', recorridoId: 'mieR', fija: true, orden: 2 },
      { clienteId: 'c1', recorridoId: 'mieA', fija: true, orden: 2 },
    ]
    expect(base('2026-11-25', dos)[0].proximaRuta?.recorridoId).toBe('mieA')
    expect(base('2026-11-25', [{ ...dos[0], orden: 1 }, dos[1]])[0].proximaRuta?.recorridoId).toBe('mieR')
  })

  it('sin asignaciones (o solo a recorridos borrados): rutas vacías y proximaRuta null', () => {
    const r = base('2026-11-23', [{ clienteId: 'c1', recorridoId: 'borrado', fija: true, orden: 0 }])
    expect(r[0]).toMatchObject({ rutas: [], proximaRuta: null })
    expect(r[1]).toMatchObject({ clienteId: 'c2', rutas: [], proximaRuta: null })
  })

  it('cerca de la medianoche en Santiago (y en el cambio de hora) el "hoy" que se pasa es el día de Chile', () => {
    const soloMartes: Recorrido[] = [{ id: 'mar', nombre: 'Martes', dia: 2, camioneta: 'C1', lejano: false }]
    const a: Asignacion[] = [{ clienteId: 'c1', recorridoId: 'mar', fija: true, orden: 0 }]
    const datos = { trabajos: [trab('t1', 1, 'c1')], lineas: [], movimientos: [], etapas, clientes, recorridos: soloMartes, asignaciones: a }
    // Verano (UTC-3): martes 24/11 23:59 en Santiago es miércoles 02:59 UTC -> hoy sigue siendo martes.
    expect(resumenListo(datos, diaLocal('2026-11-25T02:59:00Z'))[0].proximaRuta?.fecha).toBe('2026-11-24')
    // Un minuto después ya es miércoles en Santiago: la próxima es el martes siguiente.
    expect(resumenListo(datos, diaLocal('2026-11-25T03:00:00Z'))[0].proximaRuta?.fecha).toBe('2026-12-01')
    // Invierno (UTC-4): martes 2 de junio 23:30 en Santiago = 3 de junio 03:30 UTC.
    expect(resumenListo(datos, diaLocal('2026-06-03T03:30:00Z'))[0].proximaRuta?.fecha).toBe('2026-06-02')
    // Día del cambio de hora (sábado 5 de abril de 2026 -> domingo: la hora vuelve atrás): domingo -> martes 7.
    expect(resumenListo(datos, diaLocal('2026-04-05T12:00:00Z'))[0].proximaRuta?.fecha).toBe('2026-04-07')
    // Septiembre (se adelanta la hora el domingo 6): lunes 7 -> martes 8.
    expect(resumenListo(datos, diaLocal('2026-09-07T12:00:00Z'))[0].proximaRuta?.fecha).toBe('2026-09-08')
  })

  it('un "hoy" inválido lanza error', () => {
    expect(() => base('23-11-2026')).toThrow()
  })
})
