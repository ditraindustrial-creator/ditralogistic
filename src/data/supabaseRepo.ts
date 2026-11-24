import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Repo } from './repo'
import type { Area, Cliente, Movimiento, Producto, Recorrido, Rol, UsuarioActual } from '../dominio/tipos'
import { planificarClientes, planificarProductos } from '../dominio/maestros'
import { ErrorMovimiento, validarCantidad } from '../dominio/avance'

interface FilaMovimiento {
  id: string
  linea_id: string
  cantidad: number
  etapa_origen_id: string | null
  etapa_destino_id: string
  usuario_id: string
  creado_en: string
}

export function filaAMovimiento(f: FilaMovimiento): Movimiento {
  return {
    id: f.id,
    lineaId: f.linea_id,
    cantidad: f.cantidad,
    etapaOrigenId: f.etapa_origen_id,
    etapaDestinoId: f.etapa_destino_id,
    usuarioId: f.usuario_id,
    creadoEn: f.creado_en,
  }
}

/** Traduce un error de mover_unidades: las reglas de la base ya traen mensaje en español. */
export function errorDeMovimiento(e: { code?: string; message: string }): Error {
  if (e.code === 'P0001') return new ErrorMovimiento(e.message)
  if (e.code === '42501') {
    return new ErrorMovimiento(
      /row-level security/i.test(e.message) ? 'No tienes permiso para mover unidades de esta línea.' : e.message,
    )
  }
  if (e.code === '22P02') return new ErrorMovimiento('La cantidad debe ser un número entero mayor que cero.')
  return new Error('No se pudo registrar el movimiento. Revisa tu conexión e inténtalo de nuevo.')
}

interface FilaCliente {
  id: string
  nombre: string
  rut: string
  contacto: string | null
  direccion: string | null
  recorrido_id: string | null
}
interface FilaRecorrido {
  id: string
  nombre: string
  dia: number
  camioneta: string
  lejano: boolean
}
interface FilaProducto {
  id: string
  codigo: string
  nombre: string
  area: string
}

export function filaACliente(f: FilaCliente): Cliente {
  const c: Cliente = { id: f.id, nombre: f.nombre, rut: f.rut, recorridoId: f.recorrido_id }
  if (f.contacto) c.contacto = f.contacto
  if (f.direccion) c.direccion = f.direccion
  return c
}
export function filaARecorrido(f: FilaRecorrido): Recorrido {
  return { id: f.id, nombre: f.nombre, dia: f.dia as Recorrido['dia'], camioneta: f.camioneta, lejano: f.lejano }
}
export function filaAProducto(f: FilaProducto): Producto {
  return { id: f.id, codigo: f.codigo, nombre: f.nombre, area: f.area as Area }
}

/** Traduce un error de escritura de maestros a un mensaje en español. */
export function errorDeMaestros(e: { code?: string; message: string }): Error {
  if (e.code === '42501') return new Error('No tienes permiso para modificar los maestros.')
  if (e.code === '23505') return new Error('Ya existe un registro con ese RUT o código. Vuelve a cargar la lista e inténtalo de nuevo.')
  if (e.code === '23514') return new Error('Hay un dato inválido (por ejemplo un código vacío).')
  return new Error('No se pudo guardar. Revisa tu conexión e inténtalo de nuevo.')
}

function lanzarSiError(error: { code?: string; message: string } | null) {
  if (error) throw errorDeMaestros(error)
}

const LOTE = 500

const PAGINA = 1000

/**
 * Lee todas las filas de una consulta. PostgREST corta cada respuesta en un máximo (1000 en
 * Supabase), así que se pide por páginas con range() hasta recibir una vacía; avanza por lo que
 * realmente llegó, así que funciona aunque el servidor tenga un límite menor. La consulta debe
 * traer un orden estable y único (p. ej. por id) para que las páginas no se solapen.
 */
export async function leerTodas<T>(
  pagina: (desde: number, hasta: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const todas: T[] = []
  for (;;) {
    const { data, error } = await pagina(todas.length, todas.length + PAGINA - 1)
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) return todas
    todas.push(...data)
  }
}

export function crearSupabaseRepo(url: string, anonKey: string): Repo {
  return crearRepoConCliente(createClient(url, anonKey))
}

export function crearRepoConCliente(sb: SupabaseClient): Repo {

  async function cargarPerfil(id: string): Promise<UsuarioActual | null> {
    const { data, error } = await sb.from('perfiles').select('nombre, rol').eq('usuario_id', id).maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) return null
    return { id, nombre: data.nombre as string, rol: data.rol as Rol }
  }

  const repo: Repo = {
    async usuarioActual() {
      const { data } = await sb.auth.getUser()
      if (!data.user) return null
      return cargarPerfil(data.user.id)
    },
    async iniciarSesion(correo, clave) {
      const { data, error } = await sb.auth.signInWithPassword({ email: correo, password: clave })
      if (error || !data.user) throw new Error('Correo o contraseña incorrectos')
      const perfil = await cargarPerfil(data.user.id)
      if (!perfil) throw new Error('Tu usuario no tiene perfil asignado. Avisa al administrador.')
      return perfil
    },
    async cerrarSesion() {
      await sb.auth.signOut()
    },
    async moverUnidades(lineaId, cantidad, origenId, destinoId) {
      validarCantidad(cantidad)
      const { data, error } = await sb.rpc('mover_unidades', {
        p_linea: lineaId,
        p_cantidad: cantidad,
        p_origen: origenId,
        p_destino: destinoId,
      })
      if (error) throw errorDeMovimiento(error)
      return filaAMovimiento(data as FilaMovimiento)
    },
    async listarClientes() {
      try {
        const filas = await leerTodas<FilaCliente>((d, h) =>
          sb.from('clientes').select('id, nombre, rut, contacto, direccion, recorrido_id').order('id').range(d, h),
        )
        return filas.map(filaACliente).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
      } catch {
        throw new Error('No se pudieron cargar los clientes. Revisa tu conexión.')
      }
    },
    async guardarClientes(entrantes) {
      const plan = planificarClientes(await repo.listarClientes(), entrantes)
      for (let i = 0; i < plan.nuevos.length; i += LOTE) {
        const lote = plan.nuevos.slice(i, i + LOTE).map((c) => ({
          nombre: c.nombre,
          rut: c.rut,
          contacto: c.contacto ?? null,
          direccion: c.direccion ?? null,
        }))
        lanzarSiError((await sb.from('clientes').insert(lote)).error)
      }
      // Solo las filas que cambian, en lotes. Cada fila lleva únicamente lo que el archivo informó
      // (así no se borran contacto, dirección ni recorrido) y los lotes agrupan filas con las mismas
      // columnas, para que PostgREST no rellene con null las que faltan.
      const grupos = new Map<string, Record<string, unknown>[]>()
      for (const a of plan.actualizaciones) {
        const fila = { id: a.id, ...a.cambios }
        const clave = Object.keys(fila).sort().join(',')
        grupos.set(clave, [...(grupos.get(clave) ?? []), fila])
      }
      for (const filas of grupos.values()) {
        for (let i = 0; i < filas.length; i += LOTE) {
          lanzarSiError((await sb.from('clientes').upsert(filas.slice(i, i + LOTE), { onConflict: 'id' })).error)
        }
      }
      return { creados: plan.nuevos.length, actualizados: plan.actualizaciones.length, sinCambios: plan.sinCambios }
    },
    async listarRecorridos() {
      const { data, error } = await sb.from('recorridos').select('id, nombre, dia, camioneta, lejano').order('dia').order('nombre')
      if (error) throw new Error('No se pudieron cargar los recorridos. Revisa tu conexión.')
      return (data as FilaRecorrido[]).map(filaARecorrido)
    },
    async guardarRecorrido(r) {
      const fila = { nombre: r.nombre, dia: r.dia, camioneta: r.camioneta, lejano: r.lejano }
      const q = r.id ? sb.from('recorridos').update(fila).eq('id', r.id) : sb.from('recorridos').insert(fila)
      const { data, error } = await q.select('id, nombre, dia, camioneta, lejano').single()
      lanzarSiError(error)
      return filaARecorrido(data as FilaRecorrido)
    },
    async asignarRecorrido(clienteId, recorridoId) {
      const { data, error } = await sb.from('clientes').update({ recorrido_id: recorridoId }).eq('id', clienteId).select('id')
      lanzarSiError(error)
      // RLS filtra en silencio las filas que no puede tocar: sin filas actualizadas no hubo cambio.
      if (!data || data.length === 0) throw new Error('No se pudo asignar el recorrido (el cliente no existe o no tienes permiso).')
    },
    async listarProductos() {
      try {
        const filas = await leerTodas<FilaProducto>((d, h) =>
          sb.from('productos').select('id, codigo, nombre, area').order('id').range(d, h),
        )
        return filas.map(filaAProducto).sort((a, b) => a.codigo.localeCompare(b.codigo, 'es'))
      } catch {
        throw new Error('No se pudo cargar el catálogo. Revisa tu conexión.')
      }
    },
    async guardarProductos(entrantes) {
      const plan = planificarProductos(await repo.listarProductos(), entrantes)
      const todos = [...plan.nuevos, ...plan.actualizaciones.map((a) => a.cambios)]
      for (let i = 0; i < todos.length; i += LOTE) {
        lanzarSiError((await sb.from('productos').upsert(todos.slice(i, i + LOTE), { onConflict: 'codigo' })).error)
      }
      return { creados: plan.nuevos.length, actualizados: plan.actualizaciones.length, sinCambios: plan.sinCambios }
    },
  }
  return repo
}
