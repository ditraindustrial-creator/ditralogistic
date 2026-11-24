import { describe, it, expect } from 'vitest'
import { puedeVer } from './permisos'
import type { Pantalla, Rol } from './tipos'

describe('puedeVer', () => {
  it('chofer ve su hoja pero no admin', () => {
    expect(puedeVer('chofer', 'hoja_chofer')).toBe(true)
    expect(puedeVer('chofer', 'admin')).toBe(false)
  })
  it('chofer puede crear retiros desde recepcion', () => {
    expect(puedeVer('chofer', 'recepcion')).toBe(true)
  })
  it('operario de afilado ve taller pero no reporte', () => {
    expect(puedeVer('operario_afilado', 'taller')).toBe(true)
    expect(puedeVer('operario_afilado', 'reporte')).toBe(false)
  })
  it('jefe ve reporte y secretaria ve ruta', () => {
    expect(puedeVer('jefe_taller', 'reporte')).toBe(true)
    expect(puedeVer('secretaria', 'ruta')).toBe(true)
  })
  it('solo admin ve admin', () => {
    const roles: Rol[] = ['admin', 'secretaria', 'chofer', 'operario_afilado', 'operario_encuadernacion', 'jefe_taller']
    const quienes = roles.filter((r) => puedeVer(r, 'admin' as Pantalla))
    expect(quienes).toEqual(['admin'])
  })
})
