export type Rol =
  | 'admin'
  | 'secretaria'
  | 'chofer'
  | 'operario_afilado'
  | 'operario_encuadernacion'
  | 'jefe_taller'

export type Area = 'afilado' | 'encuadernacion'
export type Modalidad = 'cliente' | 'encomienda' | 'ruta_propia'

export type Pantalla =
  | 'listo'
  | 'recepcion'
  | 'taller'
  | 'ruta'
  | 'hoja_chofer'
  | 'reporte'
  | 'admin'

export interface Etapa {
  id: string
  area: Area
  orden: number
  nombre: string
  esListo: boolean
  esFinal: boolean
}

export interface Linea {
  id: string
  trabajoId: string
  producto: string
  cantidad: number
  nota?: string
  /** Servicio del catálogo (o escrito a mano) que define el taller; el chofer no lo anota. */
  servicio?: string
  /** Detalle técnico del taller (ángulo, melladura, dientes, terminación…). */
  detalleTaller?: string
}

/** Una entrega parcial planificada de un trabajo de encuadernación (hora de reloj de Chile). */
export interface EntregaParcial {
  id: string
  trabajoId: string
  /** 'YYYY-MM-DDTHH:mm' en hora de Chile. */
  planificada: string
  cantidad?: number
  nota?: string
}

export interface Movimiento {
  id: string
  lineaId: string
  cantidad: number
  etapaOrigenId: string | null
  etapaDestinoId: string
  usuarioId: string
  creadoEn: string
}

export interface Trabajo {
  id: string
  /** Número interno (correlativo global de la base); no se muestra. */
  numero: number
  /** Correlativo propio del área: 1, 2, 3… en afilado y aparte en encuadernación. Se muestra como A-001 / E-001. */
  numeroArea: number
  clienteId: string
  area: Area
  entrada: Modalidad
  salida: Modalidad
  recibidoEn: string
  guiaRetiro?: string
  guiaDespacho?: string
  factura?: string
  transporte?: string
  urgente: boolean
  notas?: string
  /** Solo encuadernación: hora planificada de entrega del trabajo completo, 'YYYY-MM-DDTHH:mm' de Chile. */
  entregaPlanificada?: string
}

export interface Cliente {
  id: string
  nombre: string
  rut: string
  contacto?: string
  direccion?: string
}

export interface Recorrido {
  id: string
  nombre: string
  dia: 1 | 2 | 3 | 4 | 5
  camioneta: string
  lejano: boolean
  /** Chofer titular (nombre para mostrar, p. ej. "Rodrigo Lagos"); opcional. */
  chofer?: string
}

/**
 * Un cliente en un recorrido (tabla cliente_recorridos). Un cliente puede estar en varios.
 * `fija`: se visita siempre ese día; si no, "a pedido" (solo si hay algo que entregar o una visita
 * solicitada o confirmada). `orden`: orden sugerido de visita dentro del recorrido (0 o más).
 */
export interface Asignacion {
  clienteId: string
  recorridoId: string
  fija: boolean
  orden: number
}

export interface Visita {
  id: string
  fecha: string
  clienteId: string
  /** Informativo; la ruta usa las asignaciones actuales del cliente (cliente_recorridos). Null en visitas extra. */
  recorridoId: string | null
  confirmada: 'si' | 'no' | 'sin_respuesta'
  requiereConfirmacion: boolean
  solicitada: boolean
  nota?: string
}

export interface UsuarioActual {
  id: string
  nombre: string
  rol: Rol
}

export interface Producto {
  id: string
  codigo: string
  nombre: string
  area: Area
  /** 'herramienta' (lo que el chofer retira) o 'servicio' (lo que hace el taller). Por defecto herramienta. */
  tipo: TipoProducto
}

export type TipoProducto = 'herramienta' | 'servicio'
