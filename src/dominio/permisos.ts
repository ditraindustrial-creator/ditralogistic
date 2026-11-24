import type { Pantalla, Rol } from './tipos'

const TODAS_OPERATIVAS: Pantalla[] = ['listo', 'recepcion', 'taller', 'ruta', 'hoja_chofer', 'reporte']

const PANTALLAS_POR_ROL: Record<Rol, readonly Pantalla[]> = {
  admin: [...TODAS_OPERATIVAS, 'admin'],
  secretaria: TODAS_OPERATIVAS,
  jefe_taller: TODAS_OPERATIVAS,
  chofer: ['ruta', 'hoja_chofer', 'recepcion'],
  operario_afilado: ['listo', 'taller'],
  operario_encuadernacion: ['listo', 'taller'],
}

export function puedeVer(rol: Rol, pantalla: Pantalla): boolean {
  return PANTALLAS_POR_ROL[rol].includes(pantalla)
}
