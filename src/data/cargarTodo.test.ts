import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { crearRepoConCliente } from './supabaseRepo'
import { crearMemoryRepo } from './memoryRepo'

type Fila = Record<string, unknown>

function crearFalso(tablas: Record<string, Fila[]>, tope = 1000) {
  const canal = { on: vi.fn(), subscribe: vi.fn() }
  canal.on.mockReturnValue(canal)
  canal.subscribe.mockReturnValue(canal)
  const sb = {
    from: (t: string) => ({
      select: () => ({
        order: (col: string) => ({
          range: (d: number, h: number) => {
            const orden = [...(tablas[t] ?? [])].sort((a, b) => String(a[col]).localeCompare(String(b[col])))
            return Promise.resolve({ data: orden.slice(d, Math.min(h + 1, d + tope)), error: null })
          },
        }),
      }),
    }),
    channel: vi.fn(() => canal),
    removeChannel: vi.fn(),
  }
  return { sb: sb as unknown as SupabaseClient, canal, espia: sb }
}

describe('supabaseRepo.cargarTodo', () => {
  it('lee más de 1000 movimientos, líneas y trabajos y los convierte', async () => {
    const pad = (i: number) => String(i).padStart(5, '0')
    const N = 2300
    const { sb } = crearFalso({
      trabajos: Array.from({ length: N }, (_, i) => ({
        id: `t${pad(i)}`, numero: i + 1, cliente_id: 'c1', area: 'afilado', entrada: 'cliente', salida: 'cliente',
        recibido_en: '2026-11-20T12:00:00Z', urgente: false,
      })),
      lineas: Array.from({ length: N }, (_, i) => ({ id: `l${pad(i)}`, trabajo_id: `t${pad(i)}`, producto: 'X', cantidad: 2, nota: null })),
      movimientos: Array.from({ length: N }, (_, i) => ({
        id: `m${pad(i)}`, linea_id: `l${pad(i)}`, cantidad: 2, etapa_origen_id: null, etapa_destino_id: 'e1', usuario_id: 'u', creado_en: '2026-11-20T12:00:00Z',
      })),
      etapas: [{ id: 'e1', area: 'afilado', orden: 1, nombre: 'Recibido', es_listo: false, es_final: false }],
      clientes: [{ id: 'c1', nombre: 'A', rut: '1-9', contacto: null, direccion: null, recorrido_id: null }],
      recorridos: [{ id: 'r1', nombre: 'Norte', dia: 2, camioneta: 'C', lejano: false }],
    })
    const d = await crearRepoConCliente(sb).cargarTodo()
    expect(d.trabajos).toHaveLength(N)
    expect(d.lineas).toHaveLength(N)
    expect(d.movimientos).toHaveLength(N)
    expect(d.movimientos[0]).toMatchObject({ lineaId: 'l00000', etapaDestinoId: 'e1', etapaOrigenId: null })
    expect(d.etapas[0]).toEqual({ id: 'e1', area: 'afilado', orden: 1, nombre: 'Recibido', esListo: false, esFinal: false })
    expect(d.trabajos[0]).toMatchObject({ numero: 1, salida: 'cliente' })
    expect(d.recorridos[0]).toMatchObject({ nombre: 'Norte', dia: 2 })
  })
})

describe('supabaseRepo.suscribirCambios', () => {
  it('escucha los cambios de movimientos, avisa y al cancelar quita el canal', () => {
    const { sb, canal, espia } = crearFalso({})
    const aviso = vi.fn()
    const cancelar = crearRepoConCliente(sb).suscribirCambios(aviso)
    expect(canal.on).toHaveBeenCalledWith('postgres_changes', { event: '*', schema: 'public', table: 'movimientos' }, expect.any(Function))
    expect(canal.subscribe).toHaveBeenCalled()
    canal.on.mock.calls[0][2]({})
    expect(aviso).toHaveBeenCalledTimes(1)
    cancelar()
    expect(espia.removeChannel).toHaveBeenCalledWith(canal)
  })
})

describe('supabaseRepo.suscribirCambios: estado del canal', () => {
  it('al quedar SUBSCRIBED avisa conectado y pide recarga; al caer avisa desconectado', () => {
    const { sb, canal } = crearFalso({})
    const cambio = vi.fn()
    const estado = vi.fn()
    crearRepoConCliente(sb).suscribirCambios(cambio, estado)
    const alEstado = canal.subscribe.mock.calls[0][0] as (e: string) => void
    alEstado('CHANNEL_ERROR')
    expect(estado).toHaveBeenLastCalledWith(false)
    expect(cambio).not.toHaveBeenCalled()
    alEstado('SUBSCRIBED')
    expect(estado).toHaveBeenLastCalledWith(true)
    expect(cambio).toHaveBeenCalledTimes(1)
  })
})

describe('memoryRepo.suscribirCambios', () => {
  it('avisa al mover unidades y deja de avisar tras cancelar', async () => {
    const repo = crearMemoryRepo({
      usuario: { id: 'u', nombre: 'U', rol: 'admin' },
      etapas: [
        { id: 'a1', area: 'afilado', orden: 1, nombre: 'R', esListo: false, esFinal: false },
        { id: 'a2', area: 'afilado', orden: 2, nombre: 'L', esListo: true, esFinal: false },
      ],
      trabajos: [{ id: 't1', numero: 1, clienteId: 'c', area: 'afilado', entrada: 'cliente', salida: 'cliente', recibidoEn: '2026-11-20T12:00:00Z', urgente: false }],
      lineas: [{ id: 'l1', trabajoId: 't1', producto: 'X', cantidad: 3 }],
      movimientos: [{ id: 'm0', lineaId: 'l1', cantidad: 3, etapaOrigenId: null, etapaDestinoId: 'a1', usuarioId: 'u', creadoEn: '2026-11-20T12:00:00Z' }],
    })
    const aviso = vi.fn()
    const cancelar = repo.suscribirCambios(aviso)
    await repo.moverUnidades('l1', 1, 'a1', 'a2')
    expect(aviso).toHaveBeenCalledTimes(1)
    expect((await repo.cargarTodo()).movimientos).toHaveLength(2)
    cancelar()
    await repo.moverUnidades('l1', 1, 'a1', 'a2')
    expect(aviso).toHaveBeenCalledTimes(1)
  })
})
