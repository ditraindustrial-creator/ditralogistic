import type { UsuarioActual } from '../dominio/tipos'

/** Acceso a datos. Cada tarea siguiente agrega sus métodos aquí y en memoryRepo. */
export interface Repo {
  /** Usuario con sesión iniciada, o null si no hay sesión. */
  usuarioActual(): Promise<UsuarioActual | null>
  iniciarSesion(correo: string, clave: string): Promise<UsuarioActual>
  cerrarSesion(): Promise<void>
}
