import type { Etapa, Linea, Movimiento, Trabajo } from './tipos'
import { distribucionPorEtapa } from './avance'
import { CANTIDAD_MAXIMA } from './trabajo'

/** Error de regla de negocio al entregar; el mensaje está en español y se muestra tal cual. */
export class ErrorEntrega extends Error {
  constructor(mensaje: string) {
    super(mensaje)
    this.name = 'ErrorEntrega'
  }
}

export interface Entrega {
  lineaId: string
  cantidad: number
}

export interface DatosEntrega {
  trabajos: Trabajo[]
  lineas: Linea[]
  movimientos: Movimiento[]
  etapas: Etapa[]
}

export interface PlanEntrega {
  /** Movimientos a registrar, desde etapas "listo" hacia la etapa final del área. */
  movimientos: { lineaId: string; cantidad: number; etapaOrigenId: string; etapaDestinoId: string }[]
  /** Nuevo valor de guía de despacho por trabajo tocado (en orden de id de trabajo). */
  guias: { trabajoId: string; guiaDespacho: string }[]
}

export const DOCUMENTO_MAXIMO = 40
export const FOTO_MAXIMA_BYTES = 8 * 1024 * 1024

const largo = (s: string) => [...s].length
const comparar = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/** Valida el número de documento (guía o factura) y lo devuelve sin espacios sobrantes. */
export function validarDocumento(documento: string): string {
  const doc = (documento ?? '').trim()
  if (doc === '') throw new ErrorEntrega('Anota el número de guía o factura.')
  if (largo(doc) > DOCUMENTO_MAXIMO) {
    throw new ErrorEntrega(`El número de documento puede tener hasta ${DOCUMENTO_MAXIMO} caracteres.`)
  }
  if (doc.includes(',')) throw new ErrorEntrega('El número de documento no puede llevar comas.')
  return doc
}

/**
 * Agrega un número de documento a la guía de despacho de un trabajo: separados por ", " y sin
 * repetir uno que ya está. Igual que la función agregar_documento de la base (0007).
 */
export function agregarDocumento(actual: string | undefined | null, documento: string): string {
  const base = (actual ?? '').trim()
  if (base === '') return documento
  if (base.split(',').some((d) => d.trim() === documento)) return base
  return `${base}, ${documento}`
}

/**
 * Valida la parte de una entrega que no depende de los datos (lista, cantidades, repetidos y
 * documento), en el mismo orden que entregar_unidades. Devuelve el documento sin espacios sobrantes.
 */
export function validarEntradaEntrega(entregas: Entrega[], documento: string): string {
  if (!Array.isArray(entregas) || entregas.length === 0) throw new ErrorEntrega('Indica qué entregar.')
  for (const e of entregas) {
    if (typeof e.lineaId !== 'string' || e.lineaId === '') throw new ErrorEntrega('Falta la línea a entregar.')
    if (!Number.isInteger(e.cantidad) || e.cantidad < 1 || e.cantidad > CANTIDAD_MAXIMA) {
      throw new ErrorEntrega('La cantidad a entregar debe ser un número entero mayor que cero.')
    }
  }
  if (new Set(entregas.map((e) => e.lineaId.toLowerCase())).size !== entregas.length) {
    throw new ErrorEntrega('No repitas la misma línea en una entrega.')
  }
  return validarDocumento(documento)
}

/**
 * Planifica una entrega (todo o nada), con las mismas reglas y mensajes que entregar_unidades en
 * la base: valida la entrada completa, procesa las líneas en orden de id y entrega solo unidades
 * que están en una etapa "listo" del área (por orden de etapa), moviéndolas a la etapa final.
 * Lanza ErrorEntrega si algo no se puede; en ese caso no hay nada que aplicar.
 */
export function planificarEntrega(datos: DatosEntrega, entregas: Entrega[], documento: string): PlanEntrega {
  const doc = validarEntradaEntrega(entregas, documento)
  const plan: PlanEntrega = { movimientos: [], guias: [] }
  const trabajosTocados = new Set<string>()
  for (const e of [...entregas].sort((a, b) => comparar(a.lineaId, b.lineaId))) {
    const linea = datos.lineas.find((l) => l.id === e.lineaId)
    const trabajo = linea && datos.trabajos.find((t) => t.id === linea.trabajoId)
    if (!linea || !trabajo) throw new ErrorEntrega('La línea no existe.')
    const delArea = datos.etapas.filter((x) => x.area === trabajo.area).sort((a, b) => a.orden - b.orden)
    const final = delArea.find((x) => x.esFinal)
    if (!final) throw new ErrorEntrega('El área no tiene una etapa de entrega configurada.')
    const dist = distribucionPorEtapa(datos.movimientos.filter((m) => m.lineaId === linea.id))
    const listas = delArea.filter((x) => x.esListo).map((x) => ({ etapa: x, n: dist.get(x.id) ?? 0 }))
    const disponibles = listas.reduce((s, x) => s + Math.max(x.n, 0), 0)
    if (e.cantidad > disponibles) {
      throw new ErrorEntrega(
        `«${linea.producto}» tiene ${disponibles} ${disponibles === 1 ? 'unidad lista' : 'unidades listas'}; ` +
          `no se pueden entregar ${e.cantidad} (faltan ${e.cantidad - disponibles}).`,
      )
    }
    let falta = e.cantidad
    for (const { etapa, n } of listas) {
      const toma = Math.min(falta, Math.max(n, 0))
      if (toma > 0) plan.movimientos.push({ lineaId: linea.id, cantidad: toma, etapaOrigenId: etapa.id, etapaDestinoId: final.id })
      falta -= toma
      if (falta === 0) break
    }
    trabajosTocados.add(trabajo.id)
  }
  for (const id of [...trabajosTocados].sort(comparar)) {
    const t = datos.trabajos.find((x) => x.id === id)!
    plan.guias.push({ trabajoId: id, guiaDespacho: agregarDocumento(t.guiaDespacho, doc) })
  }
  return plan
}

/** Lanza ErrorEntrega si el archivo no sirve como foto del documento firmado (imagen, hasta 8 MB). */
export function validarFotoDocumento(archivo: { type: string; size: number }): void {
  if (!/^image\//.test(archivo.type ?? '')) throw new ErrorEntrega('La foto debe ser una imagen.')
  if (!(archivo.size > 0)) throw new ErrorEntrega('El archivo de la foto está vacío.')
  if (archivo.size > FOTO_MAXIMA_BYTES) throw new ErrorEntrega('La foto puede pesar hasta 8 MB.')
}

/**
 * Ruta del objeto en el bucket `documentos`: `<trabajoId>/<único>.<ext>`. No usa el nombre original
 * del archivo (puede traer caracteres raros o datos personales); la extensión sale del tipo.
 */
export function nombreFotoDocumento(trabajoId: string, tipo: string, unico: string): string {
  const sub = (tipo.split('/')[1] ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
  const ext = sub === 'jpeg' ? 'jpg' : sub || 'img'
  return `${trabajoId}/${unico}.${ext}`
}
