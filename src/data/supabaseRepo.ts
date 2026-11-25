import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Repo } from './repo'
import type { Area, Asignacion, Cliente, Etapa, Linea, Modalidad, Movimiento, Producto, Recorrido, Rol, Trabajo, UsuarioActual, Visita } from '../dominio/tipos'
import {
  ErrorCliente, planificarAsignaciones, planificarClientes, planificarProductos, RUT_DUPLICADO, validarAsignacion, validarClienteNuevo,
} from '../dominio/maestros'
import { ErrorTrabajo, MODALIDADES, validarTrabajoNuevo, type DatosTrabajoNuevo } from '../dominio/trabajo'
import { ErrorEntrega, validarEntradaEntrega, validarTransporte } from '../dominio/entrega'
import { ErrorVisita, fechaValida, validarVisita } from '../dominio/ruta'
import { ErrorMovimiento, SOLO_GESTION_CORRIGE_ENTREGAS, validarCantidad } from '../dominio/avance'

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

const MENSAJES_PERMISO_MOVIMIENTO = [
  'Debes iniciar sesión para mover unidades.',
  'No tienes permiso para mover unidades de esta área.',
  SOLO_GESTION_CORRIGE_ENTREGAS,
]

/**
 * Traduce un error de mover_unidades: las reglas de la base (P0001) y sus avisos de permiso ya traen
 * mensaje en español; cualquier otro 42501 (RLS, o "permission denied for table" por falta de
 * permisos de tabla) se reemplaza por un aviso en español.
 */
export function errorDeMovimiento(e: { code?: string; message: string }): Error {
  if (e.code === 'P0001') return new ErrorMovimiento(e.message)
  if (e.code === '42501') {
    return new ErrorMovimiento(
      MENSAJES_PERMISO_MOVIMIENTO.includes(e.message) ? e.message : 'No tienes permiso para mover unidades de esta línea.',
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
}
interface FilaRecorrido {
  id: string
  nombre: string
  dia: number
  camioneta: string
  lejano: boolean
  chofer?: string | null
}
interface FilaAsignacion {
  cliente_id: string
  recorrido_id: string
  fija: boolean
  orden: number
}
const COLUMNAS_CLIENTE = 'id, nombre, rut, contacto, direccion'
const COLUMNAS_RECORRIDO = 'id, nombre, dia, camioneta, lejano, chofer'
const COLUMNAS_ASIGNACION = 'cliente_id, recorrido_id, fija, orden'
interface FilaProducto {
  id: string
  codigo: string
  nombre: string
  area: string
}

export function filaACliente(f: FilaCliente): Cliente {
  const c: Cliente = { id: f.id, nombre: f.nombre, rut: f.rut }
  if (f.contacto) c.contacto = f.contacto
  if (f.direccion) c.direccion = f.direccion
  return c
}
export function filaARecorrido(f: FilaRecorrido): Recorrido {
  const r: Recorrido = { id: f.id, nombre: f.nombre, dia: f.dia as Recorrido['dia'], camioneta: f.camioneta, lejano: f.lejano }
  if (f.chofer) r.chofer = f.chofer
  return r
}
export function filaAAsignacion(f: FilaAsignacion): Asignacion {
  return { clienteId: f.cliente_id, recorridoId: f.recorrido_id, fija: f.fija, orden: Number(f.orden) }
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
  'id, numero, cliente_id, area, entrada, salida, recibido_en, guia_retiro, guia_despacho, factura, transporte, urgente, notas'

export function filaALinea(f: FilaLinea): Linea {
  const l: Linea = { id: f.id, trabajoId: f.trabajo_id, producto: f.producto, cantidad: f.cantidad }
  if (f.nota) l.nota = f.nota
  return l
}
export function filaAEtapa(f: FilaEtapa): Etapa {
  return { id: f.id, area: f.area as Area, orden: f.orden, nombre: f.nombre, esListo: f.es_listo, esFinal: f.es_final }
}

/**
 * Traduce un error al crear un cliente. El RUT repetido (índice único clientes_rut_unico, 23505) se
 * explica en español; nunca se muestra el mensaje técnico de la base.
 */
export function errorDeCliente(e: { code?: string; message: string }): Error {
  if (e.code === '23505') return new ErrorCliente(RUT_DUPLICADO)
  if (e.code === '42501') return new ErrorCliente('No tienes permiso para crear clientes.')
  if (e.code === '22P02') return new ErrorCliente('Revisa los datos: hay un valor que no es válido.')
  return new Error('No se pudo guardar el cliente. Revisa tu conexión e inténtalo de nuevo.')
}

/** Traduce un error de escritura de maestros a un mensaje en español. */
export function errorDeMaestros(e: { code?: string; message: string }): Error {
  if (e.code === '42501') return new Error('No tienes permiso para modificar los maestros.')
  if (e.code === '23505') return new Error('Ya existe un registro con ese RUT o código. Vuelve a cargar la lista e inténtalo de nuevo.')
  if (e.code === '23514') return new Error('Hay un dato inválido (por ejemplo un código vacío).')
  return new Error('No se pudo guardar. Revisa tu conexión e inténtalo de nuevo.')
}

const SIN_PERMISO_ASIGNAR = 'No tienes permiso para cambiar los recorridos de los clientes.'

/** Traduce un error de escritura en cliente_recorridos a un mensaje en español. */
export function errorDeAsignaciones(e: { code?: string; message: string }): Error {
  if (e.code === '42501') return new Error(SIN_PERMISO_ASIGNAR)
  if (e.code === '23503') return new Error('El cliente o el recorrido ya no existe. Vuelve a cargar la página e inténtalo de nuevo.')
  if (e.code === '23514' || e.code === '22003') return new Error('El orden debe ser un número entero de 0 o más.')
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

interface FilaVisita {
  id: string
  fecha: string
  cliente_id: string
  recorrido_id: string | null
  confirmada: string
  requiere_confirmacion: boolean
  solicitada: boolean
  nota: string | null
}
const COLUMNAS_VISITA = 'id, fecha, cliente_id, recorrido_id, confirmada, requiere_confirmacion, solicitada, nota'

export function filaAVisita(f: FilaVisita): Visita {
  const v: Visita = {
    id: f.id,
    fecha: f.fecha,
    clienteId: f.cliente_id,
    recorridoId: f.recorrido_id,
    confirmada: f.confirmada as Visita['confirmada'],
    requiereConfirmacion: f.requiere_confirmacion,
    solicitada: f.solicitada,
  }
  if (f.nota) v.nota = f.nota
  return v
}

/** Traduce un error de escritura de visitas (upsert) a un mensaje en español. */
export function errorDeVisita(e: { code?: string; message: string }): Error {
  if (e.code === '42501') return new ErrorVisita('No tienes permiso para modificar las visitas.')
  if (e.code === '23503') return new ErrorVisita('El cliente no existe.')
  if (e.code === '23514') {
    if (/visitas_dia_habil/.test(e.message)) return new ErrorVisita('Las rutas son de lunes a viernes.')
    if (/visitas_nota_largo/.test(e.message)) return new ErrorVisita('La nota puede tener hasta 200 caracteres.')
    return new ErrorVisita('Hay un dato inválido en la visita.')
  }
  if (e.code === '22007' || e.code === '22008') return new ErrorVisita('La fecha no es válida.')
  return new Error('No se pudo guardar la visita. Revisa tu conexión e inténtalo de nuevo.')
}

const MENSAJES_ENTREGA = ['Debes iniciar sesión para registrar entregas.', 'No tienes permiso para registrar entregas.']

/**
 * Traduce un error de entregar_unidades. Las reglas (P0001) y los avisos de permiso propios ya vienen
 * en español; una violación de RLS genérica, un deadlock o cualquier otro error (red, mensajes en
 * inglés) se reemplaza por un mensaje en español.
 */
export function errorDeEntrega(e: { code?: string; message: string }): Error {
  if (e.code === 'P0001') return new ErrorEntrega(e.message)
  if (e.code === '42501') return new ErrorEntrega(MENSAJES_ENTREGA.includes(e.message) ? e.message : MENSAJES_ENTREGA[1])
  if (e.code === '22P02' || e.code === '22003') return new ErrorEntrega('Revisa los datos: hay un valor que no es válido.')
  if (e.code === '40P01' || e.code === '40001') {
    return new ErrorEntrega('Otra persona estaba registrando una entrega de estas mismas líneas. Inténtalo de nuevo.')
  }
  return new Error('No se pudo registrar la entrega. Revisa tu conexión e inténtalo de nuevo.')
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

  // cliente_recorridos no tiene id: orden estable por la clave primaria (cliente_id, recorrido_id).
  const leerAsignaciones = () =>
    leerTodas<FilaAsignacion>((d, h) =>
      sb.from('cliente_recorridos').select(COLUMNAS_ASIGNACION).order('cliente_id').order('recorrido_id').range(d, h),
    )

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
    async crearTrabajo(datos: DatosTrabajoNuevo, clave?: string) {
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
          // Reintento tras una respuesta perdida: con la misma clave la base devuelve el trabajo ya creado.
          clave,
        },
      })
      if (error) throw errorDeTrabajo(error)
      return filaATrabajo(data as FilaTrabajo)
    },
    async cargarTodo() {
      try {
        // Cada tabla grande se lee por páginas (PostgREST corta en 1000 filas), en paralelo.
        const [trabajos, lineas, movimientos, etapas, clientes, recorridos, asignaciones] = await Promise.all([
          leerTodas<FilaTrabajo>((d, h) => sb.from('trabajos').select(COLUMNAS_TRABAJO).order('id').range(d, h)),
          leerTodas<FilaLinea>((d, h) => sb.from('lineas').select('id, trabajo_id, producto, cantidad, nota').order('id').range(d, h)),
          leerTodas<FilaMovimiento>((d, h) =>
            sb.from('movimientos').select('id, linea_id, cantidad, etapa_origen_id, etapa_destino_id, usuario_id, creado_en').order('id').range(d, h),
          ),
          leerTodas<FilaEtapa>((d, h) => sb.from('etapas').select('id, area, orden, nombre, es_listo, es_final').order('id').range(d, h)),
          leerTodas<FilaCliente>((d, h) => sb.from('clientes').select(COLUMNAS_CLIENTE).order('id').range(d, h)),
          leerTodas<FilaRecorrido>((d, h) => sb.from('recorridos').select(COLUMNAS_RECORRIDO).order('id').range(d, h)),
          leerAsignaciones(),
        ])
        return {
          trabajos: trabajos.map(filaATrabajo),
          lineas: lineas.map(filaALinea),
          movimientos: movimientos.map(filaAMovimiento),
          etapas: etapas.map(filaAEtapa),
          clientes: clientes.map(filaACliente),
          recorridos: recorridos.map(filaARecorrido),
          asignaciones: asignaciones.map(filaAAsignacion),
        }
      } catch {
        throw new Error('No se pudo cargar la información. Revisa tu conexión.')
      }
    },
    suscribirCambios(alCambiar, alEstado) {
      // Realtime: cualquier cambio en movimientos (y los trabajos nuevos, que traen su movimiento inicial).
      const canal = sb
        .channel(`cambios-${Math.random().toString(36).slice(2)}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'movimientos' }, () => alCambiar())
        .subscribe((estado) => {
          if (estado === 'SUBSCRIBED') {
            alEstado?.(true)
            alCambiar() // pudo haber cambios antes de unirse o mientras estuvo caído
          } else {
            alEstado?.(false)
          }
        })
      return () => {
        void sb.removeChannel(canal)
      }
    },
    async listarVisitas(fecha) {
      if (!fechaValida(fecha)) throw new ErrorVisita('La fecha no es válida.')
      try {
        const filas = await leerTodas<FilaVisita>((d, h) =>
          sb.from('visitas').select(COLUMNAS_VISITA).eq('fecha', fecha).order('id').range(d, h),
        )
        return filas.map(filaAVisita)
      } catch {
        throw new Error('No se pudieron cargar las visitas. Revisa tu conexión.')
      }
    },
    async marcarVisita(fecha, clienteId, confirmada) {
      validarVisita({ fecha, clienteId, confirmada })
      // Upsert sobre la restricción única (fecha, cliente_id): solo cambia las columnas enviadas.
      const { error } = await sb
        .from('visitas')
        .upsert({ fecha, cliente_id: clienteId, confirmada }, { onConflict: 'fecha,cliente_id' })
      if (error) throw errorDeVisita(error)
    },
    async agregarVisitaExtra(fecha, clienteId, nota) {
      const texto = nota?.trim() || undefined
      validarVisita({ fecha, clienteId, nota: texto })
      // Sin nota no se manda la columna: el upsert de PostgREST solo actualiza lo enviado, así no se
      // borra la nota que la visita ya tenía.
      const fila: Record<string, unknown> = { fecha, cliente_id: clienteId, solicitada: true }
      if (texto) fila.nota = texto
      const { error } = await sb.from('visitas').upsert(fila, { onConflict: 'fecha,cliente_id' })
      if (error) throw errorDeVisita(error)
    },
    async actualizarSalida(trabajoId, salida) {
      if (!MODALIDADES.includes(salida)) throw new ErrorTrabajo('La modalidad de salida no es válida.')
      const { data, error } = await sb.from('trabajos').update({ salida }).eq('id', trabajoId).select('id')
      if (error) {
        if (error.code === '42501') throw new ErrorTrabajo('No tienes permiso para cambiar la salida.')
        throw new Error('No se pudo cambiar la salida. Revisa tu conexión e inténtalo de nuevo.')
      }
      // RLS filtra en silencio las filas que no puede tocar: sin filas actualizadas no hubo cambio.
      if (!data || data.length === 0) {
        throw new ErrorTrabajo('No se pudo cambiar la salida (el trabajo no existe o no tienes permiso).')
      }
    },
    async entregarUnidades(entregas, documento, opciones = {}) {
      const doc = validarEntradaEntrega(entregas, documento)
      const transporte = validarTransporte(opciones.transporte)
      // Una sola llamada: la base bloquea las líneas en orden fijo y entrega todo o nada. Con la misma
      // clave, un reintento (respuesta perdida) no vuelve a entregar.
      const { error } = await sb.rpc('entregar_unidades', {
        p_entregas: entregas.map((e) => ({ linea_id: e.lineaId, cantidad: e.cantidad })),
        p_documento: doc,
        p_clave: opciones.clave ?? null,
        p_transporte: transporte ?? null,
      })
      if (error) throw errorDeEntrega(error)
    },
    async listarClientes() {
      try {
        const filas = await leerTodas<FilaCliente>((d, h) => sb.from('clientes').select(COLUMNAS_CLIENTE).order('id').range(d, h))
        return filas.map(filaACliente).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
      } catch {
        throw new Error('No se pudieron cargar los clientes. Revisa tu conexión.')
      }
    },
    async crearCliente(datos) {
      const { cliente, errores } = validarClienteNuevo(datos)
      if (errores.length > 0) throw new ErrorCliente(errores[0])
      const { data, error } = await sb
        .from('clientes')
        .insert({
          nombre: cliente.nombre,
          rut: cliente.rut,
          contacto: cliente.contacto ?? null,
          direccion: cliente.direccion ?? null,
        })
        .select(COLUMNAS_CLIENTE)
        .single()
      if (error) throw errorDeCliente(error)
      return filaACliente(data as FilaCliente)
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
      const { data, error } = await sb.from('recorridos').select(COLUMNAS_RECORRIDO).order('dia').order('nombre')
      if (error) throw new Error('No se pudieron cargar los recorridos. Revisa tu conexión.')
      return (data as FilaRecorrido[]).map(filaARecorrido)
    },
    async guardarRecorrido(r) {
      const fila = { nombre: r.nombre, dia: r.dia, camioneta: r.camioneta, lejano: r.lejano, chofer: r.chofer?.trim() || null }
      const q = r.id ? sb.from('recorridos').update(fila).eq('id', r.id) : sb.from('recorridos').insert(fila)
      const { data, error } = await q.select(COLUMNAS_RECORRIDO).single()
      lanzarSiError(error)
      return filaARecorrido(data as FilaRecorrido)
    },
    async listarAsignaciones() {
      try {
        return (await leerAsignaciones()).map(filaAAsignacion)
      } catch {
        throw new Error('No se pudieron cargar los recorridos de los clientes. Revisa tu conexión.')
      }
    },
    async guardarAsignaciones(entrantes) {
      for (const a of entrantes) {
        const error = validarAsignacion(a)
        if (error) throw new Error(error)
      }
      const plan = planificarAsignaciones(await repo.listarAsignaciones(), entrantes)
      const filas = [...plan.nuevas, ...plan.actualizaciones].map((a) => ({
        cliente_id: a.clienteId, recorrido_id: a.recorridoId, fija: a.fija, orden: a.orden,
      }))
      for (let i = 0; i < filas.length; i += LOTE) {
        const { error } = await sb.from('cliente_recorridos').upsert(filas.slice(i, i + LOTE), { onConflict: 'cliente_id,recorrido_id' })
        if (error) throw errorDeAsignaciones(error)
      }
      return { creados: plan.nuevas.length, actualizados: plan.actualizaciones.length, sinCambios: plan.sinCambios }
    },
    async quitarAsignacion(clienteId, recorridoId) {
      const { data, error } = await sb
        .from('cliente_recorridos')
        .delete()
        .eq('cliente_id', clienteId)
        .eq('recorrido_id', recorridoId)
        .select('cliente_id')
      if (error) throw errorDeAsignaciones(error)
      // RLS filtra en silencio las filas que no puede borrar: sin filas borradas no hubo cambio.
      if (!data || data.length === 0) throw new Error('No se pudo quitar el recorrido (ya no estaba asignado o no tienes permiso).')
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
