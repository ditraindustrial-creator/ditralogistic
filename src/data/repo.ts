import type { Asignacion, Cliente, Modalidad, Movimiento, Producto, Recorrido, Trabajo, UsuarioActual, Visita } from '../dominio/tipos'
import type { Entrega, OpcionesEntrega } from '../dominio/entrega'
import type { DatosEdicionTrabajo, DatosTrabajoNuevo } from '../dominio/trabajo'
import type { DatosOperacion } from '../dominio/listo'
import type { ClienteImportado, ProductoImportado } from '../dominio/csv'
import type { ClienteNuevo } from '../dominio/maestros'
import type { DetalleTaller, PlanEntregas } from '../dominio/planificacion'

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
   * `clave` (uuid, una por formulario abierto): si el mismo usuario ya creó un trabajo con esa clave
   * (se perdió la respuesta y se reintenta), devuelve ese trabajo sin crear otro.
   */
  crearTrabajo(datos: DatosTrabajoNuevo, clave?: string): Promise<Trabajo>
  /**
   * Edita, todo o nada, un trabajo cuyas piezas siguen todas en Recepción (ninguna pasó al taller):
   * cambia cliente, urgente, guía de retiro, notas y líneas (agrega, quita, cambia producto, cantidad y
   * detalle; la recepción inicial de cada línea se ajusta a la nueva cantidad). El área no cambia.
   * Solo gestión. Lanza ErrorTrabajo (en español) si no se puede, p. ej. TRABAJO_YA_EN_TALLER.
   */
  editarTrabajo(trabajoId: string, datos: DatosEdicionTrabajo): Promise<Trabajo>

  listarClientes(): Promise<Cliente[]>
  /**
   * Crea un cliente (Recepción → "Cliente nuevo"; gestión y chofer). Valida con validarClienteNuevo
   * y lanza ErrorCliente en español (también si el RUT ya existe).
   */
  crearCliente(datos: ClienteNuevo): Promise<Cliente>
  /** Crea o actualiza por RUT (idempotente). No cambia los recorridos asignados. */
  guardarClientes(clientes: ClienteImportado[]): Promise<ResultadoGuardado>
  listarRecorridos(): Promise<Recorrido[]>
  /** Crea el recorrido, o lo edita si trae `id`. */
  guardarRecorrido(recorrido: Omit<Recorrido, 'id'> & { id?: string }): Promise<Recorrido>
  /** Todas las asignaciones cliente-recorrido (un cliente puede estar en varios recorridos). */
  listarAsignaciones(): Promise<Asignacion[]>
  /**
   * Crea o actualiza asignaciones por el par (cliente, recorrido), en lotes; las que ya están iguales
   * no se escriben. Solo gestión. Lanza Error en español (sin permiso, cliente o recorrido inexistente, orden inválido).
   */
  guardarAsignaciones(asignaciones: Asignacion[]): Promise<ResultadoGuardado>
  /** Quita al cliente de un recorrido. Solo gestión. Lanza Error en español si no se pudo. */
  quitarAsignacion(clienteId: string, recorridoId: string): Promise<void>
  listarProductos(): Promise<Producto[]>
  /** Crea o actualiza por código (idempotente). */
  guardarProductos(productos: ProductoImportado[]): Promise<ResultadoGuardado>

  /** Todo lo que necesita `resumenListo`: trabajos, líneas, movimientos, etapas, clientes, recorridos y asignaciones. */
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
  /**
   * Agrega (o marca como solicitada) una visita fuera de ruta en un día hábil, con nota opcional.
   * Sin nota no se borra la nota que la visita ya tenía.
   */
  agregarVisitaExtra(fecha: string, clienteId: string, nota?: string): Promise<void>
  /** Cambia la modalidad de salida de un trabajo (decide si va en la ruta, al mostrador o por encomienda). */
  actualizarSalida(trabajoId: string, salida: Modalidad): Promise<void>
  /**
   * Entrega, todo o nada, unidades listas de una o varias líneas: las mueve a la etapa final del área
   * y anota `documento` (N° de guía o factura) en la guía de despacho de cada trabajo. Nunca entrega
   * más de lo que está listo. Lanza ErrorEntrega (en español) si no se puede.
   * `opciones.clave`: si el mismo usuario ya registró esta misma entrega con esa clave, no hace nada
   * (reintento tras una respuesta perdida). `opciones.transporte`: se anota en cada trabajo tocado.
   */
  entregarUnidades(entregas: Entrega[], documento: string, opciones?: OpcionesEntrega): Promise<void>

  // ---- Detalle del taller y horas planificadas (Task 11) ----
  /**
   * Guarda el servicio y el detalle técnico de una línea (texto vacío = sin dato). Pueden gestión y
   * los operarios del área de la línea. Lanza ErrorPlanificacion (en español) si no se puede.
   */
  guardarDetalleLinea(lineaId: string, detalle: DetalleTaller): Promise<void>
  /**
   * Reemplaza, todo o nada, la hora planificada de entrega de un trabajo de encuadernación y sus
   * entregas parciales. Pueden gestión y los operarios de encuadernación. Lanza ErrorPlanificacion.
   */
  planificarEntregas(trabajoId: string, plan: PlanEntregas): Promise<void>
}
