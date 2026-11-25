import type { Area, Asignacion, Cliente, Producto, Recorrido } from './tipos'
import { normalizarNombre } from './ruta'

export interface ErrorFila {
  /** Número de fila del archivo (el encabezado es la fila 1). 0 = error de todo el archivo. */
  fila: number
  motivo: string
}

/**
 * Convierte los bytes de un archivo en texto. Excel en Chile guarda "CSV UTF-8" (UTF-8 con BOM)
 * o "CSV (delimitado por comas)" en Windows-1252; "Texto Unicode" es UTF-16 con BOM.
 * Se prueba UTF-8 estricto y, si los bytes no lo son, se usa windows-1252 (nunca falla).
 */
export function decodificarArchivo(bytes: ArrayBuffer): string {
  const u8 = new Uint8Array(bytes)
  if (u8[0] === 0xff && u8[1] === 0xfe) return new TextDecoder('utf-16le').decode(u8)
  if (u8[0] === 0xfe && u8[1] === 0xff) return new TextDecoder('utf-16be').decode(u8)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(u8)
  } catch {
    return new TextDecoder('windows-1252').decode(u8)
  }
}

const SEPARADORES = [';', ',', '\t'] as const

/** Elige el separador contando, en la primera línea y fuera de comillas, cuál aparece más (empate: ;). */
function detectarSeparador(texto: string): string {
  const cuentas: Record<string, number> = { ';': 0, ',': 0, '\t': 0 }
  let entre = false
  for (const c of texto) {
    if (c === '"') entre = !entre
    else if (!entre && (c === '\n' || c === '\r')) break
    else if (!entre && c in cuentas) cuentas[c]++
  }
  return SEPARADORES.reduce((mejor, s) => (cuentas[s] > cuentas[mejor] ? s : mejor), ';')
}

function leerRegistros(texto: string, sep: string): string[][] {
  const registros: string[][] = []
  let fila: string[] = []
  let campo = ''
  let entre = false
  let hayCampo = false // la fila tiene algo (aunque sea un campo vacío con comillas o un separador)
  const cerrarCampo = () => {
    fila.push(campo)
    campo = ''
  }
  const cerrarFila = () => {
    if (hayCampo || campo !== '' || fila.length > 0) {
      cerrarCampo()
      registros.push(fila)
    } else {
      registros.push([''])
    }
    fila = []
    hayCampo = false
  }
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i]
    if (entre) {
      if (c === '"') {
        if (texto[i + 1] === '"') {
          campo += '"'
          i++
        } else entre = false
      } else campo += c
    } else if (c === '"') {
      entre = true
      hayCampo = true
    } else if (c === sep) {
      cerrarCampo()
      hayCampo = true
    } else if (c === '\r' || c === '\n') {
      if (c === '\r' && texto[i + 1] === '\n') i++
      cerrarFila()
    } else {
      campo += c
      hayCampo = true
    }
  }
  if (hayCampo || campo !== '' || fila.length > 0) cerrarFila()
  return registros
}

/**
 * Lee un CSV (Excel en Chile: `;`, BOM, comillas, CRLF) como filas con encabezados.
 * Las líneas en blanco del final se descartan; las del medio quedan como filas vacías para que
 * el índice + 2 sea el número de fila en Excel. Filas cortas se completan con '' y las largas se recortan.
 */
export function parsearCsv(texto: string): Record<string, string>[] {
  const limpio = texto.replace(/^﻿/, '')
  const registros = leerRegistros(limpio, detectarSeparador(limpio))
  while (registros.length > 0 && registros[registros.length - 1].every((v) => v.trim() === '')) registros.pop()
  if (registros.length === 0) return []
  const encabezados = registros[0].map((h) => h.trim())
  return registros.slice(1).map((r) => {
    const obj: Record<string, string> = {}
    encabezados.forEach((h, i) => {
      if (h !== '' && !(h in obj)) obj[h] = (r[i] ?? '').trim()
    })
    return obj
  })
}

/** RUT chileno sin puntos ni espacios, con guion antes del dígito verificador: `12345678-5`. */
export function normalizarRut(s: string): string {
  const limpio = s.replace(/[^0-9kK]/g, '').toUpperCase()
  if (limpio.length < 2) return limpio
  const cuerpo = limpio.slice(0, -1).replace(/^0+(?=\d)/, '')
  return `${cuerpo}-${limpio.slice(-1)}`
}

const RUT_VALIDO = /^\d{1,9}-[\dK]$/

/** true si el RUT (ya normalizado con normalizarRut) tiene la forma 12345678-5 o 12345678-K. */
export function rutValido(rutNormalizado: string): boolean {
  return RUT_VALIDO.test(rutNormalizado)
}

function esFilaVacia(f: Record<string, string>): boolean {
  return Object.values(f).every((v) => v.trim() === '')
}

function columnasFaltantes(filas: Record<string, string>[], columnas: (string | undefined)[]): ErrorFila[] {
  if (filas.length === 0) return []
  return columnas
    .filter((c): c is string => !!c && !(c in filas[0]))
    .map((c) => ({ fila: 0, motivo: `La columna "${c}" no existe en el archivo.` }))
}

export interface MapeoClientes {
  nombre: string
  rut: string
  contacto?: string
  direccion?: string
}

export type ClienteImportado = Omit<Cliente, 'id'>

export function importarClientes(
  filas: Record<string, string>[],
  mapeo: MapeoClientes,
): { clientes: ClienteImportado[]; errores: ErrorFila[] } {
  const errores = columnasFaltantes(filas, [mapeo.nombre, mapeo.rut, mapeo.contacto, mapeo.direccion])
  if (errores.length > 0) return { clientes: [], errores }
  const clientes: ClienteImportado[] = []
  const vistos = new Map<string, number>()
  filas.forEach((f, i) => {
    const fila = i + 2
    if (esFilaVacia(f)) return
    const nombre = (f[mapeo.nombre] ?? '').trim()
    const rutCrudo = (f[mapeo.rut] ?? '').trim()
    if (rutCrudo === '') return void errores.push({ fila, motivo: 'Falta el RUT.' })
    if (nombre === '') return void errores.push({ fila, motivo: 'Falta el nombre.' })
    const rut = normalizarRut(rutCrudo)
    if (!RUT_VALIDO.test(rut)) return void errores.push({ fila, motivo: `El RUT "${rutCrudo}" no es válido.` })
    const previa = vistos.get(rut)
    if (previa !== undefined) return void errores.push({ fila, motivo: `RUT duplicado: ya aparece en la fila ${previa}.` })
    vistos.set(rut, fila)
    const c: ClienteImportado = { nombre, rut }
    const contacto = mapeo.contacto ? (f[mapeo.contacto] ?? '').trim() : ''
    const direccion = mapeo.direccion ? (f[mapeo.direccion] ?? '').trim() : ''
    if (contacto) c.contacto = contacto
    if (direccion) c.direccion = direccion
    clientes.push(c)
  })
  return { clientes, errores }
}

export interface MapeoProductos {
  codigo: string
  nombre: string
  /** Columna con el área; si no se elige, se usa areaPorDefecto. */
  area?: string
  areaPorDefecto?: Area
}

export type ProductoImportado = Omit<Producto, 'id'>

function quitarAcentos(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

function leerArea(s: string): Area | null {
  const v = quitarAcentos(s.trim().toLowerCase())
  if (v === 'afilado') return 'afilado'
  if (v === 'encuadernacion') return 'encuadernacion'
  return null
}

export function importarProductos(
  filas: Record<string, string>[],
  mapeo: MapeoProductos,
): { productos: ProductoImportado[]; errores: ErrorFila[] } {
  const errores = columnasFaltantes(filas, [mapeo.codigo, mapeo.nombre, mapeo.area])
  if (errores.length > 0) return { productos: [], errores }
  const productos: ProductoImportado[] = []
  const vistos = new Map<string, number>()
  filas.forEach((f, i) => {
    const fila = i + 2
    if (esFilaVacia(f)) return
    const codigo = (f[mapeo.codigo] ?? '').trim()
    const nombre = (f[mapeo.nombre] ?? '').trim()
    if (codigo === '') return void errores.push({ fila, motivo: 'Falta el código.' })
    if (nombre === '') return void errores.push({ fila, motivo: 'Falta el nombre.' })
    let area: Area | null | undefined = mapeo.areaPorDefecto
    if (mapeo.area) {
      const crudo = (f[mapeo.area] ?? '').trim()
      if (crudo !== '') {
        area = leerArea(crudo)
        if (!area) {
          return void errores.push({ fila, motivo: `El área "${crudo}" no es válida (usa afilado o encuadernación).` })
        }
      }
    }
    if (!area) return void errores.push({ fila, motivo: 'Falta el área.' })
    const previa = vistos.get(codigo)
    if (previa !== undefined) return void errores.push({ fila, motivo: `Código duplicado: ya aparece en la fila ${previa}.` })
    vistos.set(codigo, fila)
    productos.push({ codigo, nombre, area })
  })
  return { productos, errores }
}

export interface MapeoAsignaciones {
  /** Columna con el nombre del recorrido (como está en la pestaña Recorridos). */
  recorrido: string
  /** Columna con el RUT del cliente. */
  rut: string
  /** Columna fija (sí/no); sin columna, todas fijas. */
  fija?: string
  /** Columna orden (número entero); sin columna o vacío, la posición de la fila en su recorrido. */
  orden?: string
}

export const ORDEN_MAXIMO = 100000

function leerFija(s: string): boolean | null {
  const v = quitarAcentos(s.trim().toLowerCase())
  if (v === '' || ['si', '1', 'true', 'x'].includes(v)) return true
  if (['no', '0', 'false'].includes(v)) return false
  return null
}

/**
 * Asignaciones cliente-recorrido desde un CSV (columnas recorrido;rut;fija;orden). El recorrido se
 * reconoce por nombre sin importar mayúsculas, tildes ni espacios; el cliente por RUT normalizado.
 * `fija`: sí/si/1/true/x = fija, no/0/false = a pedido, vacío = fija. `orden` vacío = posición de la
 * fila entre las filas de su recorrido en el archivo (1, 2, 3…). Las filas malas se informan con su
 * número de fila y las buenas se importan igual. El mismo cliente dos veces en el mismo recorrido:
 * se conserva la primera fila y la repetida es error.
 */
export function importarAsignaciones(
  filas: Record<string, string>[],
  mapeo: MapeoAsignaciones,
  recorridos: Recorrido[],
  clientes: Cliente[],
): { asignaciones: Asignacion[]; errores: ErrorFila[] } {
  const errores = columnasFaltantes(filas, [mapeo.recorrido, mapeo.rut, mapeo.fija, mapeo.orden])
  if (errores.length > 0) return { asignaciones: [], errores }
  const recorridosPorNombre = new Map<string, Recorrido[]>()
  for (const r of recorridos) {
    const k = normalizarNombre(r.nombre)
    recorridosPorNombre.set(k, [...(recorridosPorNombre.get(k) ?? []), r])
  }
  const clientePorRut = new Map(clientes.map((c) => [normalizarRut(c.rut), c]))
  const posicion = new Map<string, number>()
  const vistos = new Map<string, number>()
  const asignaciones: Asignacion[] = []
  filas.forEach((f, i) => {
    const fila = i + 2
    if (esFilaVacia(f)) return
    const nombre = (f[mapeo.recorrido] ?? '').trim()
    const rutCrudo = (f[mapeo.rut] ?? '').trim()
    if (nombre === '') return void errores.push({ fila, motivo: 'Falta el recorrido.' })
    const candidatos = recorridosPorNombre.get(normalizarNombre(nombre)) ?? []
    if (candidatos.length === 0) {
      return void errores.push({ fila, motivo: `El recorrido "${nombre}" no existe. Créalo en la pestaña Recorridos o revisa cómo está escrito.` })
    }
    if (candidatos.length > 1) {
      return void errores.push({ fila, motivo: `Hay más de un recorrido llamado "${nombre}". Cambia el nombre de uno de ellos en la pestaña Recorridos.` })
    }
    const recorrido = candidatos[0]
    const lugar = (posicion.get(recorrido.id) ?? 0) + 1
    posicion.set(recorrido.id, lugar)
    if (rutCrudo === '') return void errores.push({ fila, motivo: 'Falta el RUT.' })
    const rut = normalizarRut(rutCrudo)
    if (!RUT_VALIDO.test(rut)) return void errores.push({ fila, motivo: `El RUT "${rutCrudo}" no es válido.` })
    const cliente = clientePorRut.get(rut)
    if (!cliente) return void errores.push({ fila, motivo: `No hay ningún cliente con RUT ${rut}. Impórtalo primero en la lista de clientes.` })
    const fijaCruda = mapeo.fija ? (f[mapeo.fija] ?? '').trim() : ''
    const fija = leerFija(fijaCruda)
    if (fija === null) return void errores.push({ fila, motivo: `El valor "${fijaCruda}" de la columna fija no es válido (usa sí o no).` })
    const ordenCrudo = mapeo.orden ? (f[mapeo.orden] ?? '').trim() : ''
    let orden = lugar
    if (ordenCrudo !== '') {
      if (!/^\d+$/.test(ordenCrudo) || Number(ordenCrudo) > ORDEN_MAXIMO) {
        return void errores.push({ fila, motivo: `El orden "${ordenCrudo}" no es válido (usa un número entero: 0, 1, 2…).` })
      }
      orden = Number(ordenCrudo)
    }
    const par = `${cliente.id}|${recorrido.id}`
    const previa = vistos.get(par)
    if (previa !== undefined) return void errores.push({ fila, motivo: `Cliente repetido en este recorrido: ya aparece en la fila ${previa}.` })
    vistos.set(par, fila)
    asignaciones.push({ clienteId: cliente.id, recorridoId: recorrido.id, fija, orden })
  })
  return { asignaciones, errores }
}
