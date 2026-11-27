import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { crearMemoryRepo } from './memoryRepo'
import { crearRepoConCliente, errorDeTrabajo } from './supabaseRepo'
import { ErrorTrabajo, type DatosTrabajoNuevo } from '../dominio/trabajo'
import type { Etapa, Linea, Movimiento, Trabajo, UsuarioActual } from '../dominio/tipos'

const etapas: Etapa[] = [
  { id: 'a3', area: 'afilado', orden: 3, nombre: 'Afilado', esListo: false, esFinal: false },
  { id: 'a1', area: 'afilado', orden: 1, nombre: 'Recibido', esListo: false, esFinal: false },
  { id: 'a2', area: 'afilado', orden: 2, nombre: 'En taller', esListo: false, esFinal: false },
  { id: 'b1', area: 'encuadernacion', orden: 1, nombre: 'Recibido', esListo: false, esFinal: false },
]
const secretaria: UsuarioActual = { id: 'u1', nombre: 'Sec', rol: 'secretaria' }
const datos: DatosTrabajoNuevo = {
  clienteId: 'c1',
  area: 'afilado',
  entrada: 'cliente',
  urgente: true,
  guiaRetiro: ' G-1 ',
  lineas: [{ producto: ' Cuchillo ', cantidad: 12 }, { producto: 'Tijera', cantidad: 3 }],
}

function crear(usuario: UsuarioActual | null = secretaria) {
  const trabajos: Trabajo[] = []
  const lineas: Linea[] = []
  const repo = crearMemoryRepo({
    usuario, etapas, trabajos, lineas,
    clientes: [{ id: 'c1', nombre: 'Cliente', rut: '1-9' }],
  })
  return { repo, trabajos, lineas }
}

describe('memoryRepo.crearTrabajo con clave de idempotencia', () => {
  const CLAVE = '11111111-1111-4111-8111-111111111111'
  it('el reintento con la misma clave devuelve el mismo trabajo y no crea otro', async () => {
    const { repo, trabajos, lineas } = crear()
    const a = await repo.crearTrabajo(datos, CLAVE)
    const b = await repo.crearTrabajo(datos, CLAVE)
    expect(b).toEqual(a)
    expect(trabajos).toHaveLength(1)
    expect(lineas).toHaveLength(2)
    expect((await repo.cargarTodo()).movimientos).toHaveLength(2)
  })
  it('sin clave, o con otra clave, crea trabajos nuevos', async () => {
    const { repo, trabajos } = crear()
    await repo.crearTrabajo(datos)
    await repo.crearTrabajo(datos)
    await repo.crearTrabajo(datos, CLAVE)
    await repo.crearTrabajo(datos, '22222222-2222-4222-8222-222222222222')
    expect(trabajos).toHaveLength(4)
  })
  it('la clave de otro usuario es un error que no muestra ese trabajo', async () => {
    const trabajos: Trabajo[] = []
    const r = crearMemoryRepo({
      etapas, trabajos, clientes: [{ id: 'c1', nombre: 'Cliente', rut: '1-9' }],
      cuentas: { a: { clave: 'x', usuario: secretaria }, b: { clave: 'x', usuario: { id: 'u2', nombre: 'Chofer', rol: 'chofer' } } },
    })
    await r.iniciarSesion('a', 'x')
    await r.crearTrabajo(datos, CLAVE)
    await r.iniciarSesion('b', 'x')
    await expect(r.crearTrabajo(datos, CLAVE)).rejects.toThrow(
      new ErrorTrabajo('Esta recepción no se pudo guardar. Cierra el formulario, ábrelo de nuevo e inténtalo otra vez.'),
    )
    expect(trabajos).toHaveLength(1)
  })
  it('un intento fallido no deja la clave tomada; una clave mal formada se rechaza', async () => {
    const { repo, trabajos } = crear()
    await expect(repo.crearTrabajo({ ...datos, clienteId: 'zz' }, CLAVE)).rejects.toThrow('El cliente no existe.')
    await repo.crearTrabajo(datos, CLAVE)
    expect(trabajos).toHaveLength(1)
    await expect(repo.crearTrabajo(datos, 'abc')).rejects.toThrow('La clave de la solicitud no es válida.')
  })
})

describe('memoryRepo.crearTrabajo', () => {
  it('crea trabajo y líneas con las unidades en la primera etapa (menor orden), no en la primera de la lista', async () => {
    const { repo, trabajos, lineas } = crear()
    const t = await repo.crearTrabajo(datos)
    expect(t).toMatchObject({ numero: 1, clienteId: 'c1', area: 'afilado', entrada: 'cliente', salida: 'cliente', urgente: true, guiaRetiro: 'G-1' })
    expect(trabajos).toHaveLength(1)
    expect(lineas.map((l) => [l.producto, l.cantidad])).toEqual([['Cuchillo', 12], ['Tijera', 3]])
    // Las 12 unidades están en Recibido (a1): se pueden mover todas, y ni una más.
    await expect(repo.moverUnidades(lineas[0].id, 13, 'a1', 'a2')).rejects.toThrow('Solo hay 12 unidades en esta etapa; no se pueden mover 13.')
    await expect(repo.moverUnidades(lineas[0].id, 12, 'a1', 'a2')).resolves.toMatchObject({ cantidad: 12 })
    await expect(repo.moverUnidades(lineas[0].id, 1, 'a3', 'a2')).rejects.toThrow('Solo hay 0 unidades')
  })

  it('el número es correlativo y encuadernación recibe en su propia primera etapa', async () => {
    const { repo, lineas } = crear()
    await repo.crearTrabajo(datos)
    const t2 = await repo.crearTrabajo({ ...datos, area: 'encuadernacion', lineas: [{ producto: 'Libro', cantidad: 2 }] })
    expect(t2.numero).toBe(2)
    await expect(repo.moverUnidades(lineas[2].id, 2, 'b1', 'b1')).rejects.toThrow('distintas')
  })

  it('valida con las reglas de dominio y no deja nada a medias', async () => {
    const { repo, trabajos, lineas } = crear()
    await expect(repo.crearTrabajo({ ...datos, lineas: [{ producto: 'A', cantidad: 1 }, { producto: 'B', cantidad: 0 }] })).rejects.toThrow(
      'La cantidad de la línea 2 debe ser un número entero mayor que cero.',
    )
    await expect(repo.crearTrabajo({ ...datos, lineas: [{ producto: 'A', cantidad: 1.5 }] })).rejects.toBeInstanceOf(ErrorTrabajo)
    await expect(repo.crearTrabajo({ ...datos, clienteId: 'zzz' })).rejects.toThrow('El cliente no existe.')
    await expect(repo.crearTrabajo({ ...datos, area: 'encuadernacion' as const, entrada: 'x' as never })).rejects.toThrow('Elige cómo llegó el trabajo.')
    expect(trabajos).toHaveLength(0)
    expect(lineas).toHaveLength(0)
  })

  it('exige sesión y un rol que pueda recibir (el chofer sí, el operario no)', async () => {
    await expect(crear(null).repo.crearTrabajo(datos)).rejects.toThrow('Debes iniciar sesión para recibir trabajos.')
    await expect(crear({ id: 'u2', nombre: 'Op', rol: 'operario_afilado' }).repo.crearTrabajo(datos)).rejects.toThrow('No tienes permiso para recibir trabajos.')
    await expect(crear({ id: 'u3', nombre: 'Cho', rol: 'chofer' }).repo.crearTrabajo(datos)).resolves.toMatchObject({ numero: 1 })
  })

  it('un área sin etapas no se puede recibir', async () => {
    const repo = crearMemoryRepo({ usuario: secretaria, clientes: [{ id: 'c1', nombre: 'C', rut: '1-9' }] })
    await expect(repo.crearTrabajo(datos)).rejects.toThrow('El área no tiene etapas configuradas.')
  })
})

describe('supabaseRepo.crearTrabajo', () => {
  const fila = {
    id: 't-1', numero: 41, cliente_id: 'c1', area: 'afilado', entrada: 'cliente', salida: 'cliente',
    recibido_en: '2026-11-24T10:00:00Z', guia_retiro: 'G-1', guia_despacho: null, factura: null, transporte: null,
    urgente: true, notas: null,
  }
  function falso(respuesta: { data: unknown; error: { code?: string; message: string } | null }) {
    const llamadas: { fn: string; args: unknown }[] = []
    const sb = { rpc: (fn: string, args: unknown) => { llamadas.push({ fn, args }); return Promise.resolve(respuesta) } }
    return { repo: crearRepoConCliente(sb as unknown as SupabaseClient), llamadas }
  }

  it('hace UNA sola llamada rpc crear_trabajo y devuelve el trabajo con su número', async () => {
    const { repo, llamadas } = falso({ data: fila, error: null })
    const t = await repo.crearTrabajo(datos)
    expect(t).toEqual({
      id: 't-1', numero: 41, clienteId: 'c1', area: 'afilado', entrada: 'cliente', salida: 'cliente',
      recibidoEn: '2026-11-24T10:00:00Z', guiaRetiro: 'G-1', urgente: true,
    })
    expect(llamadas).toHaveLength(1)
    expect(llamadas[0].fn).toBe('crear_trabajo')
    expect(llamadas[0].args).toEqual({
      p_datos: {
        cliente_id: 'c1', area: 'afilado', entrada: 'cliente', salida: undefined, urgente: true, guia_retiro: ' G-1 ', notas: undefined,
        lineas: [{ producto: ' Cuchillo ', cantidad: 12, nota: undefined }, { producto: 'Tijera', cantidad: 3, nota: undefined }],
        clave: undefined,
      },
    })
  })

  it('manda la clave de idempotencia dentro de p_datos', async () => {
    const { repo, llamadas } = falso({ data: fila, error: null })
    await repo.crearTrabajo(datos, '11111111-1111-4111-8111-111111111111')
    expect((llamadas[0].args as { p_datos: { clave: string } }).p_datos.clave).toBe('11111111-1111-4111-8111-111111111111')
  })

  it('no llama a la base si los datos no son válidos', async () => {
    const { repo, llamadas } = falso({ data: fila, error: null })
    await expect(repo.crearTrabajo({ ...datos, lineas: [] })).rejects.toThrow('Agrega al menos una línea.')
    expect(llamadas).toHaveLength(0)
  })

  it('muestra los mensajes de regla en español y reemplaza todo lo demás por uno genérico', async () => {
    const regla = falso({ data: null, error: { code: 'P0001', message: 'El cliente no existe.' } })
    await expect(regla.repo.crearTrabajo(datos)).rejects.toThrow('El cliente no existe.')
    for (const e of [
      { code: '42501', message: 'new row violates row-level security policy for table "trabajos"' },
      { code: '23503', message: 'insert or update on table violates foreign key constraint' },
      { code: undefined, message: 'TypeError: Failed to fetch' },
      { code: 'PGRST202', message: 'Could not find the function public.crear_trabajo in the schema cache' },
    ]) {
      const m = errorDeTrabajo(e).message
      expect(['No tienes permiso para recibir trabajos.', 'No se pudo guardar el trabajo. Revisa tu conexión e inténtalo de nuevo.']).toContain(m)
    }
    expect(errorDeTrabajo({ code: '42501', message: 'Debes iniciar sesión para recibir trabajos.' }).message).toBe('Debes iniciar sesión para recibir trabajos.')
  })
})

describe('supabaseRepo.editarTrabajo', () => {
  const fila = {
    id: 't-1', numero: 41, cliente_id: 'c2', area: 'afilado', entrada: 'cliente', salida: 'cliente',
    recibido_en: '2026-11-24T10:00:00Z', guia_retiro: null, guia_despacho: null, factura: null, transporte: null,
    urgente: false, notas: null,
  }
  function falso(respuesta: { data: unknown; error: { code?: string; message: string } | null }) {
    const llamadas: { fn: string; args: unknown }[] = []
    const sb = { rpc: (fn: string, args: unknown) => { llamadas.push({ fn, args }); return Promise.resolve(respuesta) } }
    return { repo: crearRepoConCliente(sb as unknown as SupabaseClient), llamadas }
  }

  it('hace UNA llamada rpc editar_trabajo con las líneas (con y sin id)', async () => {
    const { repo, llamadas } = falso({ data: fila, error: null })
    const t = await repo.editarTrabajo('t-1', {
      clienteId: 'c2', urgente: false,
      lineas: [{ id: 'l1', producto: 'Cuchillo', cantidad: 8, nota: 'Ø14' }, { producto: 'Hacha', cantidad: 1 }],
    })
    expect(t).toMatchObject({ id: 't-1', clienteId: 'c2' })
    expect(llamadas).toEqual([{
      fn: 'editar_trabajo',
      args: {
        p_trabajo: 't-1',
        p_datos: {
          cliente_id: 'c2', urgente: false, guia_retiro: undefined, notas: undefined,
          lineas: [{ id: 'l1', producto: 'Cuchillo', cantidad: 8, nota: 'Ø14' }, { id: undefined, producto: 'Hacha', cantidad: 1, nota: undefined }],
        },
      },
    }])
  })

  it('muestra en español el aviso de que ya pasó al taller', async () => {
    const { repo } = falso({ data: null, error: { code: 'P0001', message: 'Este trabajo ya tiene piezas en el taller: ya no se puede editar desde Recepción.' } })
    await expect(repo.editarTrabajo('t-1', { clienteId: 'c2', lineas: [{ producto: 'x', cantidad: 1 }] })).rejects.toThrow('ya tiene piezas en el taller')
  })
})
