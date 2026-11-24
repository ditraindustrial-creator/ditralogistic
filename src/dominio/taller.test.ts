import { describe, it, expect } from 'vitest'
import { areasDelRol, lineasEnCurso, reconciliarSeleccion } from './taller'
import type { DatosOperacion } from './listo'
import type { Etapa, Movimiento, Rol } from './tipos'

describe('areasDelRol', () => {
  it.each<[Rol, string[]]>([
    ['operario_afilado', ['afilado']],
    ['operario_encuadernacion', ['encuadernacion']],
    ['jefe_taller', ['afilado', 'encuadernacion']],
    ['secretaria', ['afilado', 'encuadernacion']],
    ['admin', ['afilado', 'encuadernacion']],
    ['chofer', []],
  ])('%s -> %j', (rol, esperado) => {
    expect(areasDelRol(rol)).toEqual(esperado)
  })
})

const etapas: Etapa[] = [
  { id: 'a3', area: 'afilado', orden: 3, nombre: 'Afilado', esListo: false, esFinal: false },
  { id: 'a1', area: 'afilado', orden: 1, nombre: 'Recibido', esListo: false, esFinal: false },
  { id: 'a2', area: 'afilado', orden: 2, nombre: 'En taller', esListo: false, esFinal: false },
  { id: 'a5', area: 'afilado', orden: 5, nombre: 'Entregado', esListo: false, esFinal: true },
  { id: 'b1', area: 'encuadernacion', orden: 1, nombre: 'Recibido', esListo: false, esFinal: false },
  { id: 'b2', area: 'encuadernacion', orden: 2, nombre: 'Entregado', esListo: false, esFinal: true },
]
const mov = (id: string, lineaId: string, cantidad: number, o: string | null, d: string): Movimiento => ({
  id, lineaId, cantidad, etapaOrigenId: o, etapaDestinoId: d, usuarioId: 'u', creadoEn: '2026-11-20T12:00:00Z',
})
const datos: DatosOperacion = {
  etapas,
  clientes: [{ id: 'c1', nombre: 'Imprenta Sur', rut: '1-9', recorridoId: null }],
  recorridos: [],
  trabajos: [
    { id: 't1', numero: 1, clienteId: 'c1', area: 'afilado', entrada: 'cliente', salida: 'cliente', recibidoEn: '2026-11-21T12:00:00Z', urgente: false },
    { id: 't2', numero: 2, clienteId: 'c1', area: 'afilado', entrada: 'cliente', salida: 'cliente', recibidoEn: '2026-11-22T12:00:00Z', urgente: true },
    { id: 't3', numero: 3, clienteId: 'c1', area: 'afilado', entrada: 'cliente', salida: 'cliente', recibidoEn: '2026-11-19T12:00:00Z', urgente: false },
    { id: 't4', numero: 4, clienteId: 'c1', area: 'encuadernacion', entrada: 'cliente', salida: 'cliente', recibidoEn: '2026-11-18T12:00:00Z', urgente: false },
    { id: 't5', numero: 5, clienteId: 'c1', area: 'afilado', entrada: 'cliente', salida: 'cliente', recibidoEn: '2026-11-17T12:00:00Z', urgente: false },
  ],
  lineas: [
    { id: 'l1', trabajoId: 't1', producto: 'Cuchillo', cantidad: 6 },
    { id: 'l2', trabajoId: 't2', producto: 'Tijera', cantidad: 2 },
    { id: 'l3', trabajoId: 't3', producto: 'Hoja', cantidad: 3 },
    { id: 'l4', trabajoId: 't4', producto: 'Libro', cantidad: 5 },
    { id: 'l5', trabajoId: 't5', producto: 'Sierra', cantidad: 1 },
  ],
  movimientos: [
    mov('m1', 'l1', 6, null, 'a1'), mov('m2', 'l1', 6, 'a1', 'a2'), mov('m3', 'l1', 4, 'a2', 'a3'),
    mov('m4', 'l2', 2, null, 'a1'),
    mov('m5', 'l3', 3, null, 'a1'),
    mov('m6', 'l4', 5, null, 'b1'),
    mov('m7', 'l5', 1, null, 'a1'), mov('m8', 'l5', 1, 'a1', 'a5'),
  ],
}

describe('lineasEnCurso', () => {
  it('ordena urgentes primero, luego la más antigua; oculta lo totalmente entregado', () => {
    const r = lineasEnCurso(datos, ['afilado'])
    expect(r.map((l) => l.lineaId)).toEqual(['l2', 'l3', 'l1'])
  })
  it('calcula la distribución por etapa en orden y omite etapas vacías', () => {
    const l1 = lineasEnCurso(datos, ['afilado']).find((l) => l.lineaId === 'l1')!
    expect(l1.distribucion.map((d) => [d.etapa.nombre, d.unidades])).toEqual([['En taller', 2], ['Afilado', 4]])
    expect(l1.clienteNombre).toBe('Imprenta Sur')
    expect(l1.numero).toBe(1)
    expect(l1.etapasArea.map((e) => e.id)).toEqual(['a1', 'a2', 'a3', 'a5'])
  })
  it('filtra por áreas permitidas', () => {
    expect(lineasEnCurso(datos, ['encuadernacion']).map((l) => l.lineaId)).toEqual(['l4'])
    expect(lineasEnCurso(datos, [])).toEqual([])
    expect(lineasEnCurso(datos, ['afilado', 'encuadernacion']).map((l) => l.lineaId)).toEqual(['l2', 'l4', 'l3', 'l1'])
  })
})

describe('reconciliarSeleccion', () => {
  const e = (id: string, orden: number, esFinal = false): Etapa => ({ id, area: 'afilado', orden, nombre: id, esListo: false, esFinal })
  const etapasArea = [e('a1', 1), e('a2', 2), e('a3', 3), e('a5', 5, true)]
  const dist = (pares: [string, number][]) => pares.map(([id, unidades]) => ({ etapa: etapasArea.find((x) => x.id === id)!, unidades }))
  const sel = (origenId: string, destinoId: string, cantidad: string) => ({ lineaId: 'l1', origenId, destinoId, cantidad })

  it('deja igual (misma referencia) lo que sigue siendo válido', () => {
    const s = sel('a2', 'a3', '2')
    expect(reconciliarSeleccion(s, dist([['a2', 2], ['a3', 4]]), etapasArea)).toBe(s)
  })
  it('si el origen se vació, vuelve al origen por defecto, su destino siguiente y todas las unidades', () => {
    const r = reconciliarSeleccion(sel('a2', 'a3', '2'), dist([['a3', 4]]), etapasArea)
    expect(r).toEqual(sel('a3', 'a5', '4'))
  })
  it('si el origen tiene menos unidades, ajusta la cantidad al máximo', () => {
    expect(reconciliarSeleccion(sel('a2', 'a3', '5'), dist([['a2', 3]]), etapasArea)).toEqual(sel('a2', 'a3', '3'))
  })
  it('no toca una cantidad vacía o dentro del máximo', () => {
    const s = sel('a2', 'a3', '')
    expect(reconciliarSeleccion(s, dist([['a2', 3]]), etapasArea)).toBe(s)
  })
  it('devuelve null si la línea ya no tiene unidades', () => {
    expect(reconciliarSeleccion(sel('a2', 'a3', '2'), [], etapasArea)).toBeNull()
  })
})
