import { describe, it, expect } from 'vitest'
import { crearMemoryRepo } from './memoryRepo'
import { ErrorEntrega } from '../dominio/entrega'
import { ErrorVisita } from '../dominio/ruta'
import { diaLocal } from '../dominio/fechas'
import type { Cliente, Etapa, Linea, Movimiento, Rol, Trabajo, Visita } from '../dominio/tipos'

const etapas: Etapa[] = [
  { id: 'rec', area: 'afilado', orden: 1, nombre: 'Recibido', esListo: false, esFinal: false },
  { id: 'listo', area: 'afilado', orden: 2, nombre: 'Listo', esListo: true, esFinal: false },
  { id: 'fin', area: 'afilado', orden: 3, nombre: 'Entregado', esListo: false, esFinal: true },
]
const clientes: Cliente[] = [{ id: 'c1', nombre: 'Imprenta Sur', rut: '1-9', recorridoId: null }]
const trab = (id: string, guiaDespacho?: string): Trabajo => ({
  id, numero: 1, clienteId: 'c1', area: 'afilado', entrada: 'ruta_propia', salida: 'ruta_propia',
  recibidoEn: '2026-11-20T12:00:00Z', urgente: false, ...(guiaDespacho ? { guiaDespacho } : {}),
})
const mov = (id: string, lineaId: string, cantidad: number, o: string | null, d: string): Movimiento => ({
  id, lineaId, cantidad, etapaOrigenId: o, etapaDestinoId: d, usuarioId: 'u0', creadoEn: '2026-11-20T12:00:00Z',
})

/** Fecha hábil (YYYY-MM-DD) a `dias` días de hoy en Chile, avanzando (o retrocediendo) si cae en fin de semana. */
function habil(dias: number): string {
  const d = new Date(Date.parse(`${diaLocal(new Date().toISOString())}T12:00:00Z`) + dias * 86400000)
  const paso = dias < 0 ? -1 : 1
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + paso)
  return d.toISOString().slice(0, 10)
}

function repo(rol: Rol | null = 'chofer', extra: { visitas?: Visita[] } = {}) {
  const trabajos = [trab('t1'), trab('t2', '100')]
  const lineas: Linea[] = [
    { id: 'l1', trabajoId: 't1', producto: 'Cuchillo', cantidad: 4 },
    { id: 'l2', trabajoId: 't2', producto: 'Tijera', cantidad: 2 },
  ]
  const movimientos = [
    mov('m1', 'l1', 4, null, 'rec'), mov('m2', 'l1', 4, 'rec', 'listo'),
    mov('m3', 'l2', 2, null, 'rec'), mov('m4', 'l2', 1, 'rec', 'listo'),
  ]
  const r = crearMemoryRepo({
    usuario: rol ? { id: 'u1', nombre: 'Usuario', rol } : null,
    etapas, trabajos, lineas, movimientos, clientes, visitas: extra.visitas,
  })
  return { r, trabajos }
}
const unidades = (movs: Movimiento[], lineaId: string, etapa: string) =>
  movs.filter((m) => m.lineaId === lineaId).reduce(
    (s, m) => s + (m.etapaDestinoId === etapa ? m.cantidad : 0) - (m.etapaOrigenId === etapa ? m.cantidad : 0), 0,
  )

describe('memoryRepo.entregarUnidades', () => {
  it('entregar 3 de 4 con documento 4521: queda 1 lista, 3 entregadas y la guía anotada', async () => {
    const { r } = repo()
    let avisos = 0
    r.suscribirCambios(() => avisos++)
    await r.entregarUnidades([{ lineaId: 'l1', cantidad: 3 }], '4521')
    const d = await r.cargarTodo()
    expect(unidades(d.movimientos, 'l1', 'listo')).toBe(1)
    expect(unidades(d.movimientos, 'l1', 'fin')).toBe(3)
    expect(d.movimientos.at(-1)).toMatchObject({ usuarioId: 'u1', etapaOrigenId: 'listo', etapaDestinoId: 'fin' })
    expect(d.trabajos.find((t) => t.id === 't1')?.guiaDespacho).toBe('4521')
    expect(avisos).toBe(1)
  })

  it('varias líneas a la vez; la guía que ya tenía otro número lo conserva', async () => {
    const { r, trabajos } = repo()
    const original = trabajos[1]
    await r.entregarUnidades([{ lineaId: 'l2', cantidad: 1 }, { lineaId: 'l1', cantidad: 4 }], 'F-7')
    const d = await r.cargarTodo()
    expect(d.trabajos.map((t) => t.guiaDespacho)).toEqual(['F-7', '100, F-7'])
    expect(original.guiaDespacho).toBe('100') // no modifica los objetos recibidos
  })

  it('todo o nada: si una línea no alcanza no se registra ninguna', async () => {
    const { r } = repo()
    await expect(r.entregarUnidades([{ lineaId: 'l1', cantidad: 1 }, { lineaId: 'l2', cantidad: 2 }], '9')).rejects.toThrow(
      new ErrorEntrega('«Tijera» tiene 1 unidad lista; no se pueden entregar 2 (faltan 1).'),
    )
    const d = await r.cargarTodo()
    expect(d.movimientos).toHaveLength(4)
    expect(d.trabajos.find((t) => t.id === 't1')?.guiaDespacho).toBeUndefined()
  })

  it('dos entregas simultáneas de las mismas unidades: solo una pasa', async () => {
    const { r } = repo()
    const res = await Promise.allSettled([
      r.entregarUnidades([{ lineaId: 'l1', cantidad: 3 }], 'A'),
      r.entregarUnidades([{ lineaId: 'l1', cantidad: 3 }], 'B'),
    ])
    expect(res.map((x) => x.status).sort()).toEqual(['fulfilled', 'rejected'])
    expect(unidades((await r.cargarTodo()).movimientos, 'l1', 'fin')).toBe(3)
  })

  it('pide sesión y un rol que entrega (chofer o gestión)', async () => {
    await expect(repo(null).r.entregarUnidades([{ lineaId: 'l1', cantidad: 1 }], '1')).rejects.toThrow(
      'Debes iniciar sesión para registrar entregas.',
    )
    await expect(repo('operario_afilado').r.entregarUnidades([{ lineaId: 'l1', cantidad: 1 }], '1')).rejects.toThrow(
      'No tienes permiso para registrar entregas.',
    )
    await expect(repo('secretaria').r.entregarUnidades([{ lineaId: 'l1', cantidad: 1 }], '1')).resolves.toBeUndefined()
  })
})

describe('memoryRepo: el chofer solo mueve de "listo" a la etapa final', () => {
  it('no mueve dentro del taller, sí entrega', async () => {
    const { r } = repo()
    await expect(r.moverUnidades('l2', 1, 'rec', 'listo')).rejects.toThrow('No tienes permiso para mover unidades de esta línea.')
    await expect(r.moverUnidades('l2', 1, 'listo', 'fin')).resolves.toMatchObject({ cantidad: 1 })
    await expect(repo('secretaria').r.moverUnidades('l2', 1, 'rec', 'listo')).resolves.toMatchObject({ cantidad: 1 })
  })
})

describe('memoryRepo.actualizarSalida', () => {
  it('chofer y gestión cambian la modalidad de salida', async () => {
    const { r } = repo()
    await r.actualizarSalida('t1', 'cliente')
    expect((await r.cargarTodo()).trabajos[0].salida).toBe('cliente')
  })
  it('rechaza modalidad inválida, trabajo inexistente y roles sin permiso', async () => {
    const { r } = repo()
    await expect(r.actualizarSalida('t1', 'volando' as never)).rejects.toThrow('La modalidad de salida no es válida.')
    await expect(r.actualizarSalida('zz', 'cliente')).rejects.toThrow(
      'No se pudo cambiar la salida (el trabajo no existe o no tienes permiso).',
    )
    await expect(repo('operario_afilado').r.actualizarSalida('t1', 'cliente')).rejects.toThrow(
      'No se pudo cambiar la salida (el trabajo no existe o no tienes permiso).',
    )
  })
})

describe('memoryRepo: visitas', () => {
  it('marcarVisita crea la visita del día o actualiza la existente (una por cliente y día)', async () => {
    const f = habil(1)
    const { r } = repo('secretaria')
    await r.marcarVisita(f, 'c1', 'no')
    await r.marcarVisita(f, 'c1', 'si')
    const vs = await r.listarVisitas(f)
    expect(vs).toHaveLength(1)
    expect(vs[0]).toMatchObject({ fecha: f, clienteId: 'c1', confirmada: 'si', solicitada: false, recorridoId: null })
    expect(await r.listarVisitas(habil(3))).toEqual([])
    expect(await r.listarVisitas('2026-11-28')).toEqual([]) // sábado: no hay visitas, pero no es un error
    await expect(r.listarVisitas('28-11-2026')).rejects.toThrow(new ErrorVisita('La fecha no es válida.'))
  })

  it('agregarVisitaExtra marca la visita como solicitada, con nota, sin perder la confirmación', async () => {
    const f = habil(1)
    const { r } = repo('chofer')
    await r.marcarVisita(f, 'c1', 'si')
    await r.agregarVisitaExtra(f, 'c1', '  Llamó por la guillotina ')
    expect(await r.listarVisitas(f)).toEqual([
      expect.objectContaining({ confirmada: 'si', solicitada: true, nota: 'Llamó por la guillotina' }),
    ])
  })

  it('valida fecha, día hábil, cliente y estado', async () => {
    const { r } = repo('secretaria')
    await expect(r.marcarVisita('2026-11-28', 'c1', 'si')).rejects.toThrow(new ErrorVisita('Las rutas son de lunes a viernes.'))
    await expect(r.marcarVisita('ayer', 'c1', 'si')).rejects.toThrow('La fecha no es válida.')
    await expect(r.marcarVisita(habil(1), 'zz', 'si')).rejects.toThrow('El cliente no existe.')
    await expect(r.marcarVisita(habil(1), 'c1', 'tal vez' as never)).rejects.toThrow('El estado de la visita no es válido.')
    await expect(r.agregarVisitaExtra(habil(1), 'c1', 'x'.repeat(201))).rejects.toThrow('La nota puede tener hasta 200 caracteres.')
  })

  it('el chofer no toca visitas pasadas; gestión sí; los operarios no ven ni tocan visitas', async () => {
    const pasado = habil(-1)
    const previa: Visita = {
      id: 'v1', fecha: pasado, clienteId: 'c1', recorridoId: null, confirmada: 'sin_respuesta', requiereConfirmacion: false, solicitada: false,
    }
    await expect(repo('chofer', { visitas: [previa] }).r.marcarVisita(pasado, 'c1', 'si')).rejects.toThrow(
      'No tienes permiso para modificar las visitas.',
    )
    await expect(repo('jefe_taller', { visitas: [previa] }).r.marcarVisita(pasado, 'c1', 'si')).resolves.toBeUndefined()
    const op = repo('operario_afilado', { visitas: [previa] }).r
    expect(await op.listarVisitas(pasado)).toEqual([])
    await expect(op.agregarVisitaExtra(habil(1), 'c1')).rejects.toThrow('No tienes permiso para modificar las visitas.')
    await expect(repo(null).r.marcarVisita(habil(1), 'c1', 'si')).rejects.toThrow('No tienes permiso para modificar las visitas.')
  })
})
