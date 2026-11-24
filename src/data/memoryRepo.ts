import type { Repo } from './repo'
import type { Cliente, Etapa, Linea, Movimiento, Producto, Recorrido, Trabajo, UsuarioActual } from '../dominio/tipos'
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
}

export function crearMemoryRepo(opciones: MemoryRepoOpciones = {}): Repo {
  let actual: UsuarioActual | null = opciones.usuario ?? null
  const cuentas = opciones.cuentas ?? {}
  const etapas = opciones.etapas ?? []
  const trabajos = opciones.trabajos ?? []
  const lineas = opciones.lineas ?? []
  const movimientos: Movimiento[] = [...(opciones.movimientos ?? [])]
  const clientes: Cliente[] = (opciones.clientes ?? []).map((c) => ({ ...c }))
  const recorridos: Recorrido[] = (opciones.recorridos ?? []).map((r) => ({ ...r }))
  const productos: Producto[] = (opciones.productos ?? []).map((p) => ({ ...p }))
  let siguienteId = 1

  // Sin sesión se permite (fixtures de prueba); con sesión, igual que RLS: admin y gestión.
  function exigirGestion() {
    if (actual && !['admin', 'secretaria', 'jefe_taller'].includes(actual.rol)) {
      throw new Error('No tienes permiso para modificar los maestros.')
    }
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
      validarEtapasMovimiento(
        etapas.find((e) => e.id === origenId),
        etapas.find((e) => e.id === destinoId),
        trabajo.area,
      )
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
      return mov
    },
    async listarClientes() {
      return clientes.map((c) => ({ ...c }))
    },
    async guardarClientes(entrantes) {
      exigirGestion()
      const plan = planificarClientes(clientes, entrantes)
      for (const a of plan.actualizaciones) Object.assign(clientes.find((c) => c.id === a.id)!, a.cambios)
      for (const n of plan.nuevos) clientes.push({ ...n, id: `cli-${siguienteId++}`, recorridoId: null })
      return { creados: plan.nuevos.length, actualizados: plan.actualizaciones.length }
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
      return { creados: plan.nuevos.length, actualizados: plan.actualizaciones.length }
    },
  }
}
