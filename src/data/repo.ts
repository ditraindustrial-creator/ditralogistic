import type { Movimiento, UsuarioActual } from '../dominio/tipos'

/** Acceso a datos. Cada tarea siguiente agrega sus métodos aquí y en memoryRepo. */
export interface Repo {
  /** Usuario con sesión iniciada, o null si no hay sesión. */
  usuarioActual(): Promise<UsuarioActual | null>
  iniciarSesion(correo: string, clave: string): Promise<UsuarioActual>
  cerrarSesion(): Promise<void>
  /**
   * Mueve `cantidad` unidades de una línea desde la etapa `origenId` a `destinoId`, a nombre
   * del usuario con sesión. Lanza ErrorMovimiento (mensaje en español) si no se puede.
   */
  moverUnidades(lineaId: string, cantidad: number, origenId: string, destinoId: string): Promise<Movimiento>
}
