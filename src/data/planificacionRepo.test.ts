import { describe, it, expect } from 'vitest'
import { crearMemoryRepo } from './memoryRepo'
import { errorDePlanificacion, filaALinea, filaAParcial, filaATrabajo } from './supabaseRepo'
import { ErrorPlanificacion } from '../dominio/planificacion'
import type { Rol, Trabajo } from '../dominio/tipos'

const trab = (id: string, area: Trabajo['area']): Trabajo => ({
  id, numero: 1, numeroArea: 1, clienteId: 'c1', area, entrada: 'cliente', salida: 'cliente', recibidoEn: '2026-11-20T12:00:00Z', urgente: false,
})
const repoDe = (rol: Rol) =>
  crearMemoryRepo({
    usuario: { id: 'u', nombre: 'Ana', rol },
    trabajos: [trab('taf', 'afilado'), trab('ten', 'encuadernacion')],
    lineas: [
      { id: 'laf', trabajoId: 'taf', producto: 'Cuchillo', cantidad: 3 },
      { id: 'len', trabajoId: 'ten', producto: 'Libro', cantidad: 100 },
    ],
  })

describe('memoryRepo: guardarDetalleLinea (como guardar_detalle_linea)', () => {
  it('el operario del área guarda y borra; otros roles no', async () => {
    const r = repoDe('operario_afilado')
    await r.guardarDetalleLinea('laf', { servicio: ' Afilado recto ', detalle: 'Ángulo 20°' })
    expect((await r.cargarTodo()).lineas[0]).toMatchObject({ servicio: 'Afilado recto', detalleTaller: 'Ángulo 20°' })
    await r.guardarDetalleLinea('laf', { servicio: '', detalle: '' })
    expect((await r.cargarTodo()).lineas[0]).toEqual({ id: 'laf', trabajoId: 'taf', producto: 'Cuchillo', cantidad: 3 })
    await expect(r.guardarDetalleLinea('len', { servicio: 'x' })).rejects.toThrow('No tienes permiso para cambiar el detalle de esta línea.')
    await expect(repoDe('chofer').guardarDetalleLinea('laf', { servicio: 'x' })).rejects.toBeInstanceOf(ErrorPlanificacion)
    await expect(r.guardarDetalleLinea('nada', { servicio: 'x' })).rejects.toThrow('La línea no existe.')
  })
})

describe('memoryRepo: planificarEntregas (como planificar_entregas)', () => {
  it('reemplaza todo el plan, valida contra las unidades del trabajo y solo en encuadernación', async () => {
    const r = repoDe('operario_encuadernacion')
    await r.planificarEntregas('ten', { entrega: '2026-11-28T15:00', parciales: [{ planificada: '2026-11-26T10:00', cantidad: 40 }] })
    await r.planificarEntregas('ten', { parciales: [{ planificada: '2026-11-27T10:00' }] })
    const d = await r.cargarTodo()
    expect(d.trabajos.find((t) => t.id === 'ten')?.entregaPlanificada).toBeUndefined()
    expect(d.entregasParciales?.map((p) => p.planificada)).toEqual(['2026-11-27T10:00'])
    await expect(r.planificarEntregas('ten', { parciales: [{ planificada: '2026-11-27T10:00', cantidad: 101 }] })).rejects.toThrow('el trabajo tiene 100')
    await expect(repoDe('jefe_taller').planificarEntregas('taf', { parciales: [] })).rejects.toThrow('Solo los trabajos de encuadernación')
    await expect(repoDe('operario_afilado').planificarEntregas('ten', { parciales: [] })).rejects.toThrow('No tienes permiso para planificar entregas.')
  })
})

describe('supabaseRepo: filas y errores de Task 11', () => {
  it('lee servicio, detalle, hora planificada (sin segundos) y parciales', () => {
    expect(filaALinea({ id: 'l', trabajo_id: 't', producto: 'P', cantidad: 2, nota: null, servicio: 'Afilado', detalle_taller: 'Ángulo' })).toEqual({
      id: 'l', trabajoId: 't', producto: 'P', cantidad: 2, servicio: 'Afilado', detalleTaller: 'Ángulo',
    })
    const t = filaATrabajo({
      id: 't', numero: 1, numero_area: 1, cliente_id: 'c', area: 'encuadernacion', entrada: 'cliente', salida: 'cliente', recibido_en: 'x',
      guia_retiro: null, guia_despacho: null, factura: null, transporte: null, urgente: false, notas: null, entrega_planificada: '2026-11-28T15:00:00',
    })
    expect(t.entregaPlanificada).toBe('2026-11-28T15:00')
    expect(filaAParcial({ id: 'p', trabajo_id: 't', planificada: '2026-11-26T10:00:00', cantidad: 40, nota: null })).toEqual({
      id: 'p', trabajoId: 't', planificada: '2026-11-26T10:00', cantidad: 40,
    })
    expect(filaAParcial({ id: 'p', trabajo_id: 't', planificada: '2026-11-26T10:00:00', cantidad: null, nota: 'resto' })).toEqual({
      id: 'p', trabajoId: 't', planificada: '2026-11-26T10:00', nota: 'resto',
    })
  })
  it('traduce errores: reglas y permisos en español pasan; lo técnico no', () => {
    const g = 'genérico'
    expect(errorDePlanificacion({ code: 'P0001', message: 'Las entregas parciales suman 3 unidades, pero el trabajo tiene 2.' }, g))
      .toBeInstanceOf(ErrorPlanificacion)
    expect(errorDePlanificacion({ code: '42501', message: 'No tienes permiso para planificar entregas.' }, g).message).toBe('No tienes permiso para planificar entregas.')
    expect(errorDePlanificacion({ code: '42501', message: 'permission denied for function planificar_entregas' }, g).message).toBe('No tienes permiso para hacer este cambio.')
    expect(errorDePlanificacion({ code: '22007', message: 'invalid input syntax for type timestamp' }, g).message).toMatch(/Revisa las fechas/)
    const otro = errorDePlanificacion({ code: '08000', message: 'connection' }, g)
    expect(otro).not.toBeInstanceOf(ErrorPlanificacion)
    expect(otro.message).toBe(g)
  })
})
