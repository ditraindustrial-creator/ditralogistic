import type { Repo } from './repo'
import type { Asignacion, Cliente, EntregaPlanificada, Etapa, Linea, Movimiento, Producto, Recorrido, Rol, Trabajo, UsuarioActual, Visita } from '../dominio/tipos'
import { ErrorTrabajo, MODALIDADES, primeraEtapa, RECEPCION_CLAVE_USADA, validarTrabajoNuevo, type DatosTrabajoNuevo } from '../dominio/trabajo'
import { ENTREGA_CLAVE_USADA, ErrorEntrega, planificarEntrega, validarEntradaEntrega, validarTransporte } from '../dominio/entrega'
import { ErrorVisita, fechaValida, validarVisita } from '../dominio/ruta'
import { diaLocal } from '../dominio/fechas'
import {
  ErrorCliente, planificarAsignaciones, planificarClientes, planificarProductos, RUT_DUPLICADO, validarAsignacion, validarClienteNuevo,
} from '../dominio/maestros'
import {
  ErrorMovimiento,
  distribucionPorEtapa,
  validarCantidad,
  validarEtapasFinales,
  validarEtapasMovimiento,
  validarMovimiento,
} from '../dominio/avance'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface MemoryRepoOpciones {
  /** Usuario con sesión ya iniciada. */
  usuario?: UsuarioActual | null
  /** Usuarios válidos para iniciarSesion, por correo. */
  cuentas?: Record<string, { clave: string; usuario: UsuarioActual }>
  etapas?: Etapa[]
  trabajos?: Trabajo[]
  lineas?: Linea[]
  /** Movimientos iniciales (se copian; el repo no modifica el arreglo recibido). */
  movimientos?: Movimiento[]
  clientes?: Cliente[]
  recorridos?: Recorrido[]
  asignaciones?: Asignacion[]
  productos?: Producto[]
  visitas?: Visita[]
  entregasPlanificadas?: EntregaPlanificada[]
}

const GESTION: readonly Rol[] = ['admin', 'secretaria', 'jefe_taller']
const esGestion = (u: UsuarioActual | null) => !!u && GESTION.includes(u.rol)
/** Gestión y chofer: los roles de la ruta (§5.4). */
const esDeRuta = (u: UsuarioActual | null) => esGestion(u) || u?.rol === 'chofer'

/** Repo en memoria; `simularConexion` imita la caída y vuelta del canal en vivo (para pruebas). */
export type RepoMemoria = Repo & { simularConexion(conectado: boolean): void }

export function crearMemoryRepo(opciones: MemoryRepoOpciones = {}): RepoMemoria {
  let actual: UsuarioActual | null = opciones.usuario ?? null
  const cuentas = opciones.cuentas ?? {}
  const etapas = opciones.etapas ?? []
  // Los trabajos que cambian (guía, salida) se reemplazan en el arreglo, sin tocar los objetos recibidos.
  const trabajos = opciones.trabajos ?? []
  const lineas = opciones.lineas ?? []
  const movimientos: Movimiento[] = [...(opciones.movimientos ?? [])]
  const clientes: Cliente[] = (opciones.clientes ?? []).map((c) => ({ ...c }))
  const recorridos: Recorrido[] = (opciones.recorridos ?? []).map((r) => ({ ...r }))
  let asignaciones: Asignacion[] = (opciones.asignaciones ?? []).map((a) => ({ ...a }))
  const productos: Producto[] = (opciones.productos ?? []).map((p) => ({ ...p }))
  const visitas: Visita[] = (opciones.visitas ?? []).map((v) => ({ ...v }))
  const entregasPlanificadas: EntregaPlanificada[] = (opciones.entregasPlanificadas ?? []).map((ep) => ({ ...ep }))
  let siguienteId = 1
  // Claves de idempotencia ya usadas, como trabajos.clave_idempotencia y entregas_registradas (0008).
  const clavesTrabajo = new Map<string, { usuarioId: string; trabajoId: string }>()
  const clavesEntrega = new Map<string, { usuarioId: string; documento: string; entregas: string }>()
  const oyentes = new Set<() => void>()
  const oyentesEstado = new Set<(conectado: boolean) => void>()
  const avisar = () => oyentes.forEach((f) => f())

  // Sin sesión se permite (fixtures de prueba); con sesión, igual que RLS: admin y gestión.
  function exigirGestion() {
    if (actual && !['admin', 'secretaria', 'jefe_taller'].includes(actual.rol)) {
      throw new Error('No tienes permiso para modificar los maestros.')
    }
  }

  // Como RLS de cliente_recorridos (0009): sin sesión se permite (fixtures); con sesión, solo gestión.
  const SIN_PERMISO_ASIGNAR = 'No tienes permiso para cambiar los recorridos de los clientes.'
  function exigirGestionAsignaciones() {
    if (actual && !esGestion(actual)) throw new Error(SIN_PERMISO_ASIGNAR)
  }

  // Igual que RLS de visitas (0007): gestión todo; chofer desde hoy (hora de Chile); el resto nada.
  // Upsert por (fecha, cliente), como la restricción única de la tabla.
  function guardarVisita(fecha: string, clienteId: string, cambiar: (v: Visita) => void) {
    const hoy = diaLocal(new Date().toISOString())
    if (!esGestion(actual) && !(actual?.rol === 'chofer' && fecha >= hoy)) {
      throw new ErrorVisita('No tienes permiso para modificar las visitas.')
    }
    if (!clientes.some((c) => c.id === clienteId)) throw new ErrorVisita('El cliente no existe.')
    let v = visitas.find((x) => x.fecha === fecha && x.clienteId === clienteId)
    if (!v) {
      v = {
        id: `vis-${siguienteId++}`, fecha, clienteId, recorridoId: null,
        confirmada: 'sin_respuesta', requiereConfirmacion: false, solicitada: false,
      }
      visitas.push(v)
    }
    cambiar(v)
  }

  return {
    async usuarioActual() {
      return actual
    },
    async iniciarSesion(correo, clave) {
      const c = cuentas[correo]
      if (!c || c.clave !== clave) throw new Error('Correo o contraseña incorrectos')
      actual = c.usuario
      return actual
    },
    async cerrarSesion() {
      actual = null
    },
    // Mismas reglas y orden que el trigger movimientos_validar. Todo es síncrono entre la
    // lectura y el push, así que dos llamadas simultáneas se serializan como con el bloqueo.
    async moverUnidades(lineaId, cantidad, origenId, destinoId) {
      if (!actual) throw new ErrorMovimiento('Debes iniciar sesión para mover unidades.')
      const linea = lineas.find((l) => l.id === lineaId)
      const trabajo = linea && trabajos.find((t) => t.id === linea.trabajoId)
      if (!linea || !trabajo) throw new ErrorMovimiento('La línea no existe.')
      validarCantidad(cantidad)
      const origen = etapas.find((e) => e.id === origenId)
      const destino = etapas.find((e) => e.id === destinoId)
      validarEtapasMovimiento(origen, destino, trabajo.area)
      // Como movimientos_validar (0008): a la etapa final solo se llega entregando; desde ella solo corrige gestión.
      validarEtapasFinales(origen, destino, esGestion(actual))
      // Como la política movimientos_crear (0007): el chofer solo entrega (de "listo" a la etapa final).
      if (actual.rol === 'chofer' && !(origen?.esListo && destino?.esFinal)) {
        throw new ErrorMovimiento('No tienes permiso para mover unidades de esta línea.')
      }
      validarMovimiento(distribucionPorEtapa(movimientos.filter((m) => m.lineaId === lineaId)), origenId, cantidad)
      const mov: Movimiento = {
        id: `mov-${siguienteId++}`,
        lineaId,
        cantidad,
        etapaOrigenId: origenId,
        etapaDestinoId: destinoId,
        usuarioId: actual.id,
        creadoEn: new Date().toISOString(),
      }
      movimientos.push(mov)
      avisar()
      return mov
    },
    // Mismas reglas que crear_trabajo en la base: validación completa antes de escribir, recepción
    // solo a la primera etapa del área y todo o nada. Es síncrono entre validar y escribir.
    async crearTrabajo(datos: DatosTrabajoNuevo, clave?: string) {
      if (!actual) throw new ErrorTrabajo('Debes iniciar sesión para recibir trabajos.')
      if (!['admin', 'secretaria', 'jefe_taller', 'chofer'].includes(actual.rol)) {
        throw new ErrorTrabajo('No tienes permiso para recibir trabajos.')
      }
      if (clave !== undefined && !UUID.test(clave)) throw new ErrorTrabajo('La clave de la solicitud no es válida.')
      const errores = validarTrabajoNuevo(datos)
      if (errores.length > 0) throw new ErrorTrabajo(errores[0])
      if (!clientes.some((c) => c.id === datos.clienteId)) throw new ErrorTrabajo('El cliente no existe.')
      const primera = primeraEtapa(etapas, datos.area)
      if (!primera) throw new ErrorTrabajo('El área no tiene etapas configuradas.')
      const previa = clave !== undefined ? clavesTrabajo.get(clave.toLowerCase()) : undefined
      if (previa) {
        // Reintento con la misma clave: el mismo usuario recibe lo ya creado; otro usuario, un error sin datos.
        const t = trabajos.find((x) => x.id === previa.trabajoId)
        if (previa.usuarioId !== actual.id || !t) throw new ErrorTrabajo(RECEPCION_CLAVE_USADA)
        return { ...t }
      }
      const texto = (s?: string) => s?.trim() || undefined
      const trabajo: Trabajo = {
        id: `trab-${siguienteId++}`,
        numero: trabajos.reduce((m, t) => Math.max(m, t.numero), 0) + 1,
        clienteId: datos.clienteId,
        area: datos.area,
        entrada: datos.entrada,
        salida: datos.salida ?? datos.entrada,
        recibidoEn: new Date().toISOString(),
        urgente: datos.urgente ?? false,
      }
      const guia = texto(datos.guiaRetiro)
      const notas = texto(datos.notas)
      if (guia) trabajo.guiaRetiro = guia
      if (notas) trabajo.notas = notas
      const nuevasLineas: Linea[] = datos.lineas.map((l) => {
        const linea: Linea = { id: `lin-${siguienteId++}`, trabajoId: trabajo.id, producto: l.producto.trim(), cantidad: l.cantidad }
        const nota = texto(l.nota)
        if (nota) linea.nota = nota
        return linea
      })
      const creadoEn = trabajo.recibidoEn
      trabajos.push(trabajo)
      lineas.push(...nuevasLineas)
      if (clave !== undefined) clavesTrabajo.set(clave.toLowerCase(), { usuarioId: actual.id, trabajoId: trabajo.id })
      for (const l of nuevasLineas) {
        movimientos.push({
          id: `mov-${siguienteId++}`, lineaId: l.id, cantidad: l.cantidad,
          etapaOrigenId: null, etapaDestinoId: primera.id, usuarioId: actual.id, creadoEn,
        })
      }
      avisar()
      return { ...trabajo }
    },
    async cargarTodo() {
      return {
        trabajos: trabajos.map((t) => ({ ...t })),
        lineas: lineas.map((l) => ({ ...l })),
        movimientos: movimientos.map((m) => ({ ...m })),
        etapas: etapas.map((e) => ({ ...e })),
        clientes: clientes.map((c) => ({ ...c })),
        recorridos: recorridos.map((r) => ({ ...r })),
        asignaciones: asignaciones.map((a) => ({ ...a })),
        entregasPlanificadas: entregasPlanificadas.map((ep) => ({ ...ep })),
      }
    },
    suscribirCambios(alCambiar, alEstado) {
      oyentes.add(alCambiar)
      if (alEstado) oyentesEstado.add(alEstado)
      return () => {
        oyentes.delete(alCambiar)
        if (alEstado) oyentesEstado.delete(alEstado)
      }
    },
    simularConexion(conectado) {
      oyentesEstado.forEach((f) => f(conectado))
      if (conectado) avisar()
    },
    async listarVisitas(fecha) {
      if (!fechaValida(fecha)) throw new ErrorVisita('La fecha no es válida.')
      if (!esDeRuta(actual)) return []
      return visitas.filter((v) => v.fecha === fecha).map((v) => ({ ...v }))
    },
    async marcarVisita(fecha, clienteId, confirmada) {
      validarVisita({ fecha, clienteId, confirmada })
      guardarVisita(fecha, clienteId, (v) => {
        v.confirmada = confirmada
      })
    },
    async agregarVisitaExtra(fecha, clienteId, nota) {
      const texto = nota?.trim() || undefined
      validarVisita({ fecha, clienteId, nota: texto })
      guardarVisita(fecha, clienteId, (v) => {
        v.solicitada = true
        if (texto) v.nota = texto // sin nota, se conserva la que ya tenía
      })
    },
    async actualizarSalida(trabajoId, salida) {
      if (!MODALIDADES.includes(salida)) throw new ErrorTrabajo('La modalidad de salida no es válida.')
      const i = trabajos.findIndex((t) => t.id === trabajoId)
      if (i < 0 || !esDeRuta(actual)) {
        throw new ErrorTrabajo('No se pudo cambiar la salida (el trabajo no existe o no tienes permiso).')
      }
      trabajos[i] = { ...trabajos[i], salida }
      avisar()
    },
    // Mismas reglas que entregar_unidades: plan completo (todo o nada) y luego se aplica. Es síncrono
    // entre planificar y escribir, así que dos entregas simultáneas se serializan como con el bloqueo.
    async entregarUnidades(entregas, documento, opciones = {}) {
      if (!actual) throw new ErrorEntrega('Debes iniciar sesión para registrar entregas.')
      if (!esDeRuta(actual)) throw new ErrorEntrega('No tienes permiso para registrar entregas.')
      const doc = validarEntradaEntrega(entregas, documento)
      const transporte = validarTransporte(opciones.transporte)
      const clave = opciones.clave?.toLowerCase()
      const huella = JSON.stringify([...entregas].map((e) => [e.lineaId.toLowerCase(), e.cantidad]).sort())
      const previa = clave !== undefined ? clavesEntrega.get(clave) : undefined
      if (previa) {
        // Reintento de la misma entrega por el mismo usuario: ya quedó registrada, no se hace nada.
        if (previa.usuarioId === actual.id && previa.documento === doc && previa.entregas === huella) return
        throw new ErrorEntrega(ENTREGA_CLAVE_USADA)
      }
      const plan = planificarEntrega({ trabajos, lineas, movimientos, etapas }, entregas, documento)
      const creadoEn = new Date().toISOString()
      for (const m of plan.movimientos) {
        movimientos.push({ id: `mov-${siguienteId++}`, ...m, usuarioId: actual.id, creadoEn })
      }
      for (const g of plan.guias) {
        const i = trabajos.findIndex((t) => t.id === g.trabajoId)
        trabajos[i] = { ...trabajos[i], guiaDespacho: g.guiaDespacho, ...(transporte ? { transporte } : {}) }
      }
      if (clave !== undefined) clavesEntrega.set(clave, { usuarioId: actual.id, documento: doc, entregas: huella })
      avisar()
    },
    async listarClientes() {
      return clientes.map((c) => ({ ...c }))
    },
    // Como RLS (clientes_gestion y clientes_chofer_crea) y el índice único de RUT (0004).
    async crearCliente(datos) {
      if (!actual) throw new ErrorCliente('Debes iniciar sesión para crear clientes.')
      if (!esDeRuta(actual)) throw new ErrorCliente('No tienes permiso para crear clientes.')
      const { cliente, errores } = validarClienteNuevo(datos)
      if (errores.length > 0) throw new ErrorCliente(errores[0])
      if (clientes.some((c) => c.rut === cliente.rut)) throw new ErrorCliente(RUT_DUPLICADO)
      const nuevo: Cliente = { ...cliente, id: `cli-${siguienteId++}` }
      clientes.push(nuevo)
      return { ...nuevo }
    },
    async guardarClientes(entrantes) {
      exigirGestion()
      const plan = planificarClientes(clientes, entrantes)
      for (const a of plan.actualizaciones) Object.assign(clientes.find((c) => c.id === a.id)!, a.cambios)
      for (const n of plan.nuevos) clientes.push({ ...n, id: `cli-${siguienteId++}` })
      return { creados: plan.nuevos.length, actualizados: plan.actualizaciones.length, sinCambios: plan.sinCambios }
    },
    async listarRecorridos() {
      return recorridos.map((r) => ({ ...r }))
    },
    async guardarRecorrido(r) {
      exigirGestion()
      const existente = r.id ? recorridos.find((x) => x.id === r.id) : undefined
      // Como la columna chofer (0009): opcional; vacío = sin chofer.
      const chofer = r.chofer?.trim() || undefined
      const datos: Omit<Recorrido, 'id'> = { nombre: r.nombre, dia: r.dia, camioneta: r.camioneta, lejano: r.lejano }
      if (chofer) datos.chofer = chofer
      if (existente) {
        delete existente.chofer
        Object.assign(existente, datos)
        return { ...existente }
      }
      const nuevo: Recorrido = { ...datos, id: r.id ?? `rec-${siguienteId++}` }
      recorridos.push(nuevo)
      return { ...nuevo }
    },
    async listarAsignaciones() {
      return asignaciones.map((a) => ({ ...a }))
    },
    // Como cliente_recorridos (0009): todo validado antes de escribir; upsert por (cliente, recorrido).
    async guardarAsignaciones(entrantes) {
      exigirGestionAsignaciones()
      for (const a of entrantes) {
        const error = validarAsignacion(a)
        if (error) throw new Error(error)
        if (!clientes.some((c) => c.id === a.clienteId)) throw new Error('El cliente no existe.')
        if (!recorridos.some((r) => r.id === a.recorridoId)) throw new Error('El recorrido no existe.')
      }
      const plan = planificarAsignaciones(asignaciones, entrantes)
      for (const a of plan.actualizaciones) {
        Object.assign(asignaciones.find((x) => x.clienteId === a.clienteId && x.recorridoId === a.recorridoId)!, { fija: a.fija, orden: a.orden })
      }
      for (const a of plan.nuevas) asignaciones.push({ ...a })
      return { creados: plan.nuevas.length, actualizados: plan.actualizaciones.length, sinCambios: plan.sinCambios }
    },
    async quitarAsignacion(clienteId, recorridoId) {
      exigirGestionAsignaciones()
      const antes = asignaciones.length
      asignaciones = asignaciones.filter((a) => !(a.clienteId === clienteId && a.recorridoId === recorridoId))
      if (asignaciones.length === antes) throw new Error('No se pudo quitar el recorrido (ya no estaba asignado o no tienes permiso).')
    },
    async listarProductos() {
      return productos.map((p) => ({ ...p }))
    },
    async guardarProductos(entrantes) {
      exigirGestion()
      const plan = planificarProductos(productos, entrantes)
      for (const a of plan.actualizaciones) Object.assign(productos.find((p) => p.id === a.id)!, a.cambios)
      for (const n of plan.nuevos) productos.push({ ...n, id: `prod-${siguienteId++}` })
      return { creados: plan.nuevos.length, actualizados: plan.actualizaciones.length, sinCambios: plan.sinCambios }
    },
    async actualizarDetalleLinea(lineaId, cambios) {
      if (!actual) throw new Error('Debes iniciar sesión.')
      const linea = lineas.find((l) => l.id === lineaId)
      const trabajo = linea && trabajos.find((t) => t.id === linea.trabajoId)
      if (!linea || !trabajo) throw new Error('La línea no existe.')
      const puedeEditar =
        esGestion(actual) ||
        (actual.rol === 'operario_afilado' && trabajo.area === 'afilado') ||
        (actual.rol === 'operario_encuadernacion' && trabajo.area === 'encuadernacion')
      if (!puedeEditar) throw new Error('Sin permiso para actualizar el detalle de esta línea.')
      if ('detalleTaller' in cambios) linea.detalleTaller = cambios.detalleTaller ?? undefined
      if ('servicioId' in cambios) linea.servicioId = cambios.servicioId ?? undefined
    },
    async guardarEntregaPlanificada(trabajoId, hora, cantidad, nota) {
      if (!esGestion(actual)) throw new Error('No tienes permiso para gestionar entregas planificadas.')
      const ep: EntregaPlanificada = { id: `ep-${siguienteId++}`, trabajoId, hora, cantidad, ...(nota ? { nota } : {}) }
      entregasPlanificadas.push(ep)
      avisar()
      return { ...ep }
    },
    async actualizarEntregaPlanificada(id, cambios) {
      if (!esGestion(actual)) throw new Error('No tienes permiso para gestionar entregas planificadas.')
      const ep = entregasPlanificadas.find((x) => x.id === id)
      if (!ep) throw new Error('La entrega planificada no existe.')
      if (cambios.hora !== undefined) ep.hora = cambios.hora
      if (cambios.cantidad !== undefined) ep.cantidad = cambios.cantidad
      if ('nota' in cambios) ep.nota = cambios.nota ?? undefined
      avisar()
    },
    async eliminarEntregaPlanificada(id) {
      if (!esGestion(actual)) throw new Error('No tienes permiso para gestionar entregas planificadas.')
      const idx = entregasPlanificadas.findIndex((x) => x.id === id)
      if (idx < 0) throw new Error('La entrega planificada no existe.')
      entregasPlanificadas.splice(idx, 1)
      avisar()
    },
    async actualizarEntregaPlanificadaTrabajo(trabajoId, hora) {
      if (!esGestion(actual)) throw new Error('No tienes permiso para gestionar entregas planificadas.')
      const i = trabajos.findIndex((t) => t.id === trabajoId)
      if (i < 0) throw new Error('El trabajo no existe.')
      if (hora === null) {
        const { entregaPlanificada: _, ...rest } = trabajos[i]
        trabajos[i] = rest
      } else {
        trabajos[i] = { ...trabajos[i], entregaPlanificada: hora }
      }
      avisar()
    },
  }
}
