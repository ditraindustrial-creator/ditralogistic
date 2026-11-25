import type { Area, Pantalla, Rol } from './tipos'

const TODAS_OPERATIVAS: Pantalla[] = ['listo', 'recepcion', 'taller', 'ruta', 'hoja_chofer', 'reporte']

const PANTALLAS_POR_ROL: Record<Rol, readonly Pantalla[]> = {
  admin: [...TODAS_OPERATIVAS, 'admin'],
  secretaria: [...TODAS_OPERATIVAS, 'admin'],
  jefe_taller: [...TODAS_OPERATIVAS, 'admin'],
  chofer: ['ruta', 'hoja_chofer', 'recepcion'],
  operario_afilado: ['listo', 'taller'],
  operario_encuadernacion: ['listo', 'taller'],
}

export function puedeVer(rol: Rol, pantalla: Pantalla): boolean {
  return PANTALLAS_POR_ROL[rol].includes(pantalla)
}

const ROLES_QUE_ENTREGAN: readonly Rol[] = ['admin', 'secretaria', 'jefe_taller', 'chofer']

/** Quién puede registrar entregas (igual que entregar_unidades en la base: gestión y chofer). */
export function puedeEntregar(rol: Rol): boolean {
  return ROLES_QUE_ENTREGAN.includes(rol)
}

const GESTION: readonly Rol[] = ['admin', 'secretaria', 'jefe_taller']

/** Roles de gestión (igual que es_gestion() en la base): ven y corrigen todo lo operativo. */
export function esGestion(rol: Rol): boolean {
  return GESTION.includes(rol)
}

/** Quién puede crear un cliente nuevo desde Recepción (RLS: clientes_gestion y clientes_chofer_crea). */
export function puedeCrearClientes(rol: Rol): boolean {
  return esGestion(rol) || rol === 'chofer'
}

/** Quién completa el servicio y el detalle técnico de una línea (como guardar_detalle_linea): gestión y los operarios de esa área. */
export function puedeDetallar(rol: Rol, area: Area): boolean {
  return esGestion(rol) || (rol === 'operario_afilado' && area === 'afilado') || (rol === 'operario_encuadernacion' && area === 'encuadernacion')
}

/** Quién planifica las horas de entrega de encuadernación (como planificar_entregas): gestión y operarios de encuadernación. */
export function puedePlanificar(rol: Rol): boolean {
  return esGestion(rol) || rol === 'operario_encuadernacion'
}
