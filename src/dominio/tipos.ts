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
  servicioId?: string
  detalleTaller?: string
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
  numero: number
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
  tipo?: 'herramienta' | 'servicio'
}
