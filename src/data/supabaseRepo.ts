import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Repo } from './repo'
import type { Area, Cliente, Etapa, Linea, Modalidad, Movimiento, Producto, Recorrido, Rol, Trabajo, UsuarioActual } from '../dominio/tipos'
import { planificarClientes, planificarProductos } from '../dominio/maestros'
import { ErrorTrabajo, validarTrabajoNuevo, type DatosTrabajoNuevo } from '../dominio/trabajo'
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

interface FilaTrabajo {
  id: string
  numero: number
  cliente_id: string
  area: string
  entrada: string
  salida: string
  recibido_en: string
  guia_retiro: string | null
  guia_despacho: string | null
  factura: string | null
  transporte: string | null
  urgente: boolean
  notas: string | null
  foto_documento: string | null
}

export function filaATrabajo(f: FilaTrabajo): Trabajo {
  const t: Trabajo = {
    id: f.id,
    numero: Number(f.numero),
    clienteId: f.cliente_id,
    area: f.area as Area,
    entrada: f.entrada as Modalidad,
    salida: f.salida as Modalidad,
    recibidoEn: f.recibido_en,
    urgente: f.urgente,
  }
  if (f.guia_retiro) t.guiaRetiro = f.guia_retiro
  if (f.guia_despacho) t.guiaDespacho = f.guia_despacho
  if (f.factura) t.factura = f.factura
  if (f.transporte) t.transporte = f.transporte
  if (f.notas) t.notas = f.notas
  if (f.foto_documento) t.fotoDocumento = f.foto_documento
  return t
}

const MENSAJES_PERMISO = ['Debes iniciar sesión para recibir trabajos.', 'No tienes permiso para recibir trabajos.']

/**
 * Traduce un error de crear_trabajo. Las reglas de la base (P0001) y los dos avisos de permiso ya
 * vienen en español; cualquier otro error (red, restricciones, mensajes en inglés) se reemplaza
 * por un mensaje genérico para no mostrar texto técnico.
 */
export function errorDeTrabajo(e: { code?: string; message: string }): Error {
  if (e.code === 'P0001') return new ErrorTrabajo(e.message)
  if (e.code === '42501') {
    return new ErrorTrabajo(MENSAJES_PERMISO.includes(e.message) ? e.message : 'No tienes permiso para recibir trabajos.')
  }
  if (e.code === '22P02' || e.code === '22003') return new ErrorTrabajo('Revisa los datos: hay un valor que no es válido.')
  return new Error('No se pudo guardar el trabajo. Revisa tu conexión e inténtalo de nuevo.')
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

interface FilaLinea {
  id: string
  trabajo_id: string
  producto: string
  cantidad: number
  nota: string | null
}
interface FilaEtapa {
  id: string
  area: string
  orden: number
  nombre: string
  es_listo: boolean
  es_final: boolean
}

const COLUMNAS_TRABAJO =
  'id, numero, cliente_id, area, entrada, salida, recibido_en, guia_retiro, guia_despacho, factura, transporte, urgente, notas, foto_documento'

export function filaALinea(f: FilaLinea): Linea {
  const l: Linea = { id: f.id, trabajoId: f.trabajo_id, producto: f.producto, cantidad: f.cantidad }
  if (f.nota) l.nota = f.nota
  return l
}
export function filaAEtapa(f: FilaEtapa): Etapa {
  return { id: f.id, area: f.area as Area, orden: f.orden, nombre: f.nombre, esListo: f.es_listo, esFinal: f.es_final }
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
    async crearTrabajo(datos: DatosTrabajoNuevo) {
      const errores = validarTrabajoNuevo(datos)
      if (errores.length > 0) throw new ErrorTrabajo(errores[0])
      // Una sola llamada a la base: trabajo, líneas y movimientos iniciales en una transacción.
      const { data, error } = await sb.rpc('crear_trabajo', {
        p_datos: {
          cliente_id: datos.clienteId,
          area: datos.area,
          entrada: datos.entrada,
          salida: datos.salida,
          urgente: datos.urgente ?? false,
          guia_retiro: datos.guiaRetiro,
          notas: datos.notas,
          lineas: datos.lineas.map((l) => ({ producto: l.producto, cantidad: l.cantidad, nota: l.nota })),
        },
      })
      if (error) throw errorDeTrabajo(error)
      return filaATrabajo(data as FilaTrabajo)
    },
    async cargarTodo() {
      try {
        // Cada tabla grande se lee por páginas (PostgREST corta en 1000 filas), en paralelo.
        const [trabajos, lineas, movimientos, etapas, clientes, recorridos] = await Promise.all([
          leerTodas<FilaTrabajo>((d, h) => sb.from('trabajos').select(COLUMNAS_TRABAJO).order('id').range(d, h)),
          leerTodas<FilaLinea>((d, h) => sb.from('lineas').select('id, trabajo_id, producto, cantidad, nota').order('id').range(d, h)),
          leerTodas<FilaMovimiento>((d, h) =>
            sb.from('movimientos').select('id, linea_id, cantidad, etapa_origen_id, etapa_destino_id, usuario_id, creado_en').order('id').range(d, h),
          ),
          leerTodas<FilaEtapa>((d, h) => sb.from('etapas').select('id, area, orden, nombre, es_listo, es_final').order('id').range(d, h)),
          leerTodas<FilaCliente>((d, h) =>
            sb.from('clientes').select('id, nombre, rut, contacto, direccion, recorrido_id').order('id').range(d, h),
          ),
          leerTodas<FilaRecorrido>((d, h) => sb.from('recorridos').select('id, nombre, dia, camioneta, lejano').order('id').range(d, h)),
        ])
        return {
          trabajos: trabajos.map(filaATrabajo),
          lineas: lineas.map(filaALinea),
          movimientos: movimientos.map(filaAMovimiento),
          etapas: etapas.map(filaAEtapa),
          clientes: clientes.map(filaACliente),
          recorridos: recorridos.map(filaARecorrido),
        }
      } catch {
        throw new Error('No se pudo cargar la información. Revisa tu conexión.')
      }
    },
    suscribirCambios(alCambiar) {
      // Realtime: cualquier cambio en movimientos (y los trabajos nuevos, que traen su movimiento inicial).
      const canal = sb
        .channel(`cambios-${Math.random().toString(36).slice(2)}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'movimientos' }, () => alCambiar())
        .subscribe()
      return () => {
        void sb.removeChannel(canal)
      }
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
