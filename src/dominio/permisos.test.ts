import { describe, it, expect } from 'vitest'
import { esGestion, puedeCrearClientes, puedeEntregar, puedeVer } from './permisos'
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
  it('gestión ve admin, operarios y chofer no', () => {
    const roles: Rol[] = ['admin', 'secretaria', 'chofer', 'operario_afilado', 'operario_encuadernacion', 'jefe_taller']
    const quienes = roles.filter((r) => puedeVer(r, 'admin' as Pantalla))
    expect(quienes).toEqual(['admin', 'secretaria', 'jefe_taller'])
  })
})

describe('puedeEntregar', () => {
  it('solo gestión y chofer, como entregar_unidades en la base', () => {
    for (const r of ['admin', 'secretaria', 'jefe_taller', 'chofer'] as const) expect(puedeEntregar(r)).toBe(true)
    for (const r of ['operario_afilado', 'operario_encuadernacion'] as const) expect(puedeEntregar(r)).toBe(false)
  })
})

describe('esGestion y puedeCrearClientes', () => {
  const roles: Rol[] = ['admin', 'secretaria', 'jefe_taller', 'chofer', 'operario_afilado', 'operario_encuadernacion']
  it('gestión = admin, secretaria y jefe de taller (como es_gestion() en la base)', () => {
    expect(roles.filter(esGestion)).toEqual(['admin', 'secretaria', 'jefe_taller'])
  })
  it('crean clientes gestión y chofer, no los operarios', () => {
    expect(roles.filter(puedeCrearClientes)).toEqual(['admin', 'secretaria', 'jefe_taller', 'chofer'])
  })
})
