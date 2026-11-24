import type { Cliente, Movimiento, Producto, Recorrido, UsuarioActual } from '../dominio/tipos'
import type { ClienteImportado, ProductoImportado } from '../dominio/csv'

export interface ResultadoGuardado {
  creados: number
  actualizados: number
}

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

  listarClientes(): Promise<Cliente[]>
  /** Crea o actualiza por RUT (idempotente). No cambia el recorrido de los que ya existen. */
  guardarClientes(clientes: ClienteImportado[]): Promise<ResultadoGuardado>
  listarRecorridos(): Promise<Recorrido[]>
  /** Crea el recorrido, o lo edita si trae `id`. */
  guardarRecorrido(recorrido: Omit<Recorrido, 'id'> & { id?: string }): Promise<Recorrido>
  /** Asigna (o quita, con null) el recorrido fijo de un cliente. */
  asignarRecorrido(clienteId: string, recorridoId: string | null): Promise<void>
  listarProductos(): Promise<Producto[]>
  /** Crea o actualiza por código (idempotente). */
  guardarProductos(productos: ProductoImportado[]): Promise<ResultadoGuardado>
}
