import type { Repo } from './repo'
import type { UsuarioActual } from '../dominio/tipos'

export interface MemoryRepoOpciones {
  /** Usuario con sesión ya iniciada. */
  usuario?: UsuarioActual | null
  /** Usuarios válidos para iniciarSesion, por correo. */
  cuentas?: Record<string, { clave: string; usuario: UsuarioActual }>
}

export function crearMemoryRepo(opciones: MemoryRepoOpciones = {}): Repo {
  let actual: UsuarioActual | null = opciones.usuario ?? null
  const cuentas = opciones.cuentas ?? {}
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
  }
}
