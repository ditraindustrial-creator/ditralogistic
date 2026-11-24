import type { Cliente, Modalidad, Movimiento, Producto, Recorrido, Trabajo, UsuarioActual, Visita } from '../dominio/tipos'
import type { Entrega } from '../dominio/entrega'
import type { DatosTrabajoNuevo } from '../dominio/trabajo'
import type { DatosOperacion } from '../dominio/listo'
import type { ClienteImportado, ProductoImportado } from '../dominio/csv'

export interface ResultadoGuardado {
  creados: number
  actualizados: number
  /** Filas del archivo que ya estaban guardadas tal cual. */
  sinCambios: number
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

  /**
   * Recibe un trabajo: lo crea con sus líneas y, por cada línea, un movimiento inicial (sin origen)
   * hacia la primera etapa del área con la cantidad completa, todo o nada. Lanza ErrorTrabajo
   * (mensaje en español) si no se puede.
   */
  crearTrabajo(datos: DatosTrabajoNuevo): Promise<Trabajo>

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

  /** Todo lo que necesita `resumenListo`: trabajos, líneas, movimientos, etapas, clientes y recorridos. */
  cargarTodo(): Promise<DatosOperacion>
  /**
   * Avisa (sin datos) cada vez que cambian los movimientos, para que la pantalla recargue.
   * `alEstado` informa si el canal en vivo está conectado; al (re)conectarse también se llama
   * `alCambiar`, porque pudo haber cambios mientras estuvo caído.
   * Devuelve la función que cancela la suscripción.
   */
  suscribirCambios(alCambiar: () => void, alEstado?: (conectado: boolean) => void): () => void

  // ---- Ruta de mañana y hoja del chofer (Task 7) ----
  /** Visitas de un día ('YYYY-MM-DD'). Los roles sin acceso (operarios) reciben una lista vacía. */
  listarVisitas(fecha: string): Promise<Visita[]>
  /**
   * Marca la confirmación de la visita de un cliente en un día hábil. Si aún no hay visita ese día
   * se crea (una por cliente y día). Lanza ErrorVisita (en español) si no se puede.
   */
  marcarVisita(fecha: string, clienteId: string, confirmada: Visita['confirmada']): Promise<void>
  /** Agrega (o marca como solicitada) una visita fuera de ruta en un día hábil, con nota opcional. */
  agregarVisitaExtra(fecha: string, clienteId: string, nota?: string): Promise<void>
  /** Cambia la modalidad de salida de un trabajo (decide si va en la ruta, al mostrador o por encomienda). */
  actualizarSalida(trabajoId: string, salida: Modalidad): Promise<void>
  /**
   * Entrega, todo o nada, unidades listas de una o varias líneas: las mueve a la etapa final del área
   * y anota `documento` (N° de guía o factura) en la guía de despacho de cada trabajo. Nunca entrega
   * más de lo que está listo. Lanza ErrorEntrega (en español) si no se puede.
   */
  entregarUnidades(entregas: Entrega[], documento: string): Promise<void>
  /**
   * Sube la foto (opcional) del documento firmado al bucket `documentos`, en la carpeta del trabajo,
   * y la asocia al trabajo. Solo imágenes de hasta 8 MB. Devuelve la ruta guardada.
   */
  subirFotoDocumento(trabajoId: string, archivo: File): Promise<string>
  /**
   * URL temporal (unos 5 minutos) para abrir una foto ya subida, a partir de la ruta guardada en
   * `Trabajo.fotoDocumento`. Lanza un error en español si no existe o no se tiene permiso.
   */
  urlFotoDocumento(ruta: string): Promise<string>
}
