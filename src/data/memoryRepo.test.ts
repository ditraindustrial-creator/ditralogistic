import { describe, it, expect } from 'vitest'
import { crearMemoryRepo } from './memoryRepo'
import { ErrorMovimiento } from '../dominio/avance'
import type { Etapa, Linea, Movimiento, Trabajo } from '../dominio/tipos'

const etapas: Etapa[] = [
  { id: 'taller', area: 'afilado', orden: 2, nombre: 'En taller', esListo: false, esFinal: false },
  { id: 'listo', area: 'afilado', orden: 4, nombre: 'Listo', esListo: true, esFinal: false },
  { id: 'enc', area: 'encuadernacion', orden: 2, nombre: 'En producción', esListo: false, esFinal: false },
]
const trabajos: Trabajo[] = [
  {
    id: 't1', numero: 1, numeroArea: 1, clienteId: 'c1', area: 'afilado', entrada: 'cliente', salida: 'cliente',
    recibidoEn: '2026-11-24T09:00:00Z', urgente: false,
  },
]
const lineas: Linea[] = [{ id: 'l1', trabajoId: 't1', producto: 'Cuchillo', cantidad: 6 }]
const recepcion: Movimiento = {
  id: 'm0', lineaId: 'l1', cantidad: 6, etapaOrigenId: null, etapaDestinoId: 'taller',
  usuarioId: 'u1', creadoEn: '2026-11-24T09:00:00Z',
}

function repo(usuario = { id: 'u1', nombre: 'Op', rol: 'operario_afilado' as const }) {
  return crearMemoryRepo({ usuario, etapas, trabajos, lineas, movimientos: [recepcion] })
}

describe('memoryRepo.moverUnidades', () => {
  it('registra el movimiento con el usuario de la sesión', async () => {
    const m = await repo().moverUnidades('l1', 4, 'taller', 'listo')
    expect(m).toMatchObject({ lineaId: 'l1', cantidad: 4, etapaOrigenId: 'taller', etapaDestinoId: 'listo', usuarioId: 'u1' })
    expect(Number.isNaN(Date.parse(m.creadoEn))).toBe(false)
  })

  it('después de mover 4 de 6 no deja mover 3 y no cambia nada al fallar', async () => {
    const r = repo()
    await r.moverUnidades('l1', 4, 'taller', 'listo')
    await expect(r.moverUnidades('l1', 3, 'taller', 'listo')).rejects.toThrow(
      'Solo hay 2 unidades en esta etapa; no se pueden mover 3.',
    )
    await expect(r.moverUnidades('l1', 2, 'taller', 'listo')).resolves.toMatchObject({ cantidad: 2 })
  })

  it('rechaza cantidades 0, negativas o decimales con ErrorMovimiento', async () => {
    const r = repo()
    for (const c of [0, -1, 1.5]) {
      await expect(r.moverUnidades('l1', c, 'taller', 'listo')).rejects.toBeInstanceOf(ErrorMovimiento)
    }
    await expect(r.moverUnidades('l1', 6, 'taller', 'listo')).resolves.toMatchObject({ cantidad: 6 })
  })

  it('rechaza etapas de otra área u origen igual a destino', async () => {
    const r = repo()
    await expect(r.moverUnidades('l1', 1, 'taller', 'enc')).rejects.toThrow('Las etapas no corresponden al área del trabajo.')
    await expect(r.moverUnidades('l1', 1, 'taller', 'taller')).rejects.toThrow(
      'La etapa de origen y la de destino deben ser distintas.',
    )
  })

  it('rechaza una línea inexistente o sin sesión', async () => {
    await expect(repo().moverUnidades('nope', 1, 'taller', 'listo')).rejects.toThrow('La línea no existe.')
    const sinSesion = crearMemoryRepo({ etapas, trabajos, lineas, movimientos: [recepcion] })
    await expect(sinSesion.moverUnidades('l1', 1, 'taller', 'listo')).rejects.toThrow(
      'Debes iniciar sesión para mover unidades.',
    )
  })

  it('dos movimientos simultáneos nunca superan el total de la línea', async () => {
    const r = repo()
    const res = await Promise.allSettled([
      r.moverUnidades('l1', 4, 'taller', 'listo'),
      r.moverUnidades('l1', 4, 'taller', 'listo'),
    ])
    expect(res.filter((x) => x.status === 'fulfilled')).toHaveLength(1)
    await expect(r.moverUnidades('l1', 3, 'taller', 'listo')).rejects.toBeInstanceOf(ErrorMovimiento)
  })
})

describe('memoryRepo.crearTrabajo: numeración por área', () => {
  it('afilado y encuadernación llevan correlativos separados', async () => {
    const r = crearMemoryRepo({
      usuario: { id: 'u1', nombre: 'Sec', rol: 'secretaria' },
      etapas, trabajos, lineas, movimientos: [recepcion],
      clientes: [{ id: 'c1', nombre: 'Cliente', rut: '1-9' }],
    })
    const nuevo = (area: Trabajo['area']) =>
      r.crearTrabajo({ clienteId: 'c1', area, entrada: 'cliente', lineas: [{ producto: 'X', cantidad: 1 }] })
    expect((await nuevo('encuadernacion')).numeroArea).toBe(1)
    expect((await nuevo('afilado')).numeroArea).toBe(2) // ya había un afilado (t1)
    expect((await nuevo('encuadernacion')).numeroArea).toBe(2)
  })
})
