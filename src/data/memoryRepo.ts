import type { Repo } from './repo'
import type { Cliente, Etapa, Linea, Movimiento, Producto, Recorrido, Rol, Trabajo, UsuarioActual, Visita } from '../dominio/tipos'
import { ErrorTrabajo, MODALIDADES, primeraEtapa, validarTrabajoNuevo, type DatosTrabajoNuevo } from '../dominio/trabajo'
import { ErrorEntrega, planificarEntrega } from '../dominio/entrega'
import { ErrorVisita, fechaValida, validarVisita } from '../dominio/ruta'
import { diaLocal } from '../dominio/fechas'
import { planificarClientes, planificarProductos } from '../dominio/maestros'
import {
  ErrorMovimiento,
  distribucionPorEtapa,
  validarCantidad,
  validarEtapasMovimiento,
  validarMovimiento,
} from '../dominio/avance'

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
  productos?: Producto[]
  visitas?: Visita[]
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
  const productos: Producto[] = (opciones.productos ?? []).map((p) => ({ ...p }))
  const visitas: Visita[] = (opciones.visitas ?? []).map((v) => ({ ...v }))
  let siguienteId = 1
  const oyentes = new Set<() => void>()
  const oyentesEstado = new Set<(conectado: boolean) => void>()
  const avisar = () => oyentes.forEach((f) => f())

  // Sin sesión se permite (fixtures de prueba); con sesión, igual que RLS: admin y gestión.
  function exigirGestion() {
    if (actual && !['admin', 'secretaria', 'jefe_taller'].includes(actual.rol)) {
      throw new Error('No tienes permiso para modificar los maestros.')
    }
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
    async crearTrabajo(datos: DatosTrabajoNuevo) {
      if (!actual) throw new ErrorTrabajo('Debes iniciar sesión para recibir trabajos.')
      if (!['admin', 'secretaria', 'jefe_taller', 'chofer'].includes(actual.rol)) {
        throw new ErrorTrabajo('No tienes permiso para recibir trabajos.')
      }
      const errores = validarTrabajoNuevo(datos)
      if (errores.length > 0) throw new ErrorTrabajo(errores[0])
      if (!clientes.some((c) => c.id === datos.clienteId)) throw new ErrorTrabajo('El cliente no existe.')
      const primera = primeraEtapa(etapas, datos.area)
      if (!primera) throw new ErrorTrabajo('El área no tiene etapas configuradas.')
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
        if (texto) v.nota = texto
        else delete v.nota
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
    async entregarUnidades(entregas, documento) {
      if (!actual) throw new ErrorEntrega('Debes iniciar sesión para registrar entregas.')
      if (!esDeRuta(actual)) throw new ErrorEntrega('No tienes permiso para registrar entregas.')
      const plan = planificarEntrega({ trabajos, lineas, movimientos, etapas }, entregas, documento)
      const creadoEn = new Date().toISOString()
      for (const m of plan.movimientos) {
        movimientos.push({ id: `mov-${siguienteId++}`, ...m, usuarioId: actual.id, creadoEn })
      }
      for (const g of plan.guias) {
        const i = trabajos.findIndex((t) => t.id === g.trabajoId)
        trabajos[i] = { ...trabajos[i], guiaDespacho: g.guiaDespacho }
      }
      avisar()
    },
    async listarClientes() {
      return clientes.map((c) => ({ ...c }))
    },
    async guardarClientes(entrantes) {
      exigirGestion()
      const plan = planificarClientes(clientes, entrantes)
      for (const a of plan.actualizaciones) Object.assign(clientes.find((c) => c.id === a.id)!, a.cambios)
      for (const n of plan.nuevos) clientes.push({ ...n, id: `cli-${siguienteId++}`, recorridoId: null })
      return { creados: plan.nuevos.length, actualizados: plan.actualizaciones.length, sinCambios: plan.sinCambios }
    },
    async listarRecorridos() {
      return recorridos.map((r) => ({ ...r }))
    },
    async guardarRecorrido(r) {
      exigirGestion()
      const existente = r.id ? recorridos.find((x) => x.id === r.id) : undefined
      if (existente) {
        Object.assign(existente, r)
        return { ...existente }
      }
      const nuevo: Recorrido = { ...r, id: r.id ?? `rec-${siguienteId++}` }
      recorridos.push(nuevo)
      return { ...nuevo }
    },
    async asignarRecorrido(clienteId, recorridoId) {
      exigirGestion()
      const c = clientes.find((x) => x.id === clienteId)
      if (!c) throw new Error('El cliente no existe.')
      if (recorridoId !== null && !recorridos.some((r) => r.id === recorridoId)) throw new Error('El recorrido no existe.')
      c.recorridoId = recorridoId
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
  }
}
