import type { Repo } from './repo'
import type { Etapa, Linea, Movimiento, Trabajo, UsuarioActual } from '../dominio/tipos'
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
}

export function crearMemoryRepo(opciones: MemoryRepoOpciones = {}): Repo {
  let actual: UsuarioActual | null = opciones.usuario ?? null
  const cuentas = opciones.cuentas ?? {}
  const etapas = opciones.etapas ?? []
  const trabajos = opciones.trabajos ?? []
  const lineas = opciones.lineas ?? []
  const movimientos: Movimiento[] = [...(opciones.movimientos ?? [])]
  let siguienteId = 1

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
  }
}
