import { useState, type ReactNode } from 'react'
import type { ResultadoGuardado } from '../../data/repo'
import { decodificarArchivo, parsearCsv, type ErrorFila } from '../../dominio/csv'

const boton = 'min-h-12 rounded bg-teal-700 px-5 py-3 text-lg font-semibold text-white disabled:opacity-50'
const campo = 'min-h-12 rounded border p-3 text-lg'

function leerArchivo(file: File): Promise<ArrayBuffer> {
  return new Promise((resolver, rechazar) => {
    const lector = new FileReader()
    lector.onload = () => resolver(lector.result as ArrayBuffer)
    lector.onerror = () => rechazar(new Error('No se pudo leer el archivo.'))
    lector.readAsArrayBuffer(file)
  })
}

export function mensaje(e: unknown, porDefecto: string): string {
  return e instanceof Error ? e.message : porDefecto
}

function pluralNuevos(n: number, singular: string, plural: string): string {
  return n === 1 ? `1 ${singular} nuevo` : `${n} ${plural} nuevos`
}

export function resumen(r: ResultadoGuardado, singular: string, plural: string): string {
  const act = r.actualizados === 1 ? '1 actualizado' : `${r.actualizados} actualizados`
  return `${pluralNuevos(r.creados, singular, plural)}, ${act}, ${r.sinCambios} sin cambios.`
}

export interface CampoImportador {
  clave: string
  etiqueta: string
  obligatorio: boolean
  /** Palabras que, si aparecen en un encabezado, lo hacen la opción sugerida. */
  pistas: string[]
}

export interface ResultadoImportacion {
  resumen: string
  errores: ErrorFila[]
}

export function sinAcentos(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

function sugerir(columnas: string[], pistas: string[], yaUsadas: string[]): string {
  return columnas.find((c) => !yaUsadas.includes(c) && pistas.some((p) => sinAcentos(c).includes(p))) ?? ''
}

/** Subir un CSV, elegir qué columna es cada campo e importar. Las reglas viven en dominio/csv. */
export function Importador({
  etiquetaArchivo,
  ayuda,
  campos,
  textoBoton,
  extra,
  ejecutar,
}: {
  etiquetaArchivo: string
  /** Texto de ayuda bajo el selector de archivo. */
  ayuda?: string
  campos: CampoImportador[]
  textoBoton: string
  extra?: ReactNode
  ejecutar: (filas: Record<string, string>[], mapeo: Record<string, string>) => Promise<ResultadoImportacion>
}) {
  const [filas, setFilas] = useState<Record<string, string>[] | null>(null)
  const [mapeo, setMapeo] = useState<Record<string, string>>({})
  const [resultado, setResultado] = useState<ResultadoImportacion | null>(null)
  const [error, setError] = useState('')
  const [trabajando, setTrabajando] = useState(false)

  async function alElegirArchivo(file: File | undefined) {
    setResultado(null)
    setError('')
    setFilas(null)
    if (!file) return
    try {
      const nuevas = parsearCsv(decodificarArchivo(await leerArchivo(file)))
      if (nuevas.length === 0) {
        setError('El archivo no tiene filas para importar.')
        return
      }
      const columnas = Object.keys(nuevas[0])
      const sugerido: Record<string, string> = {}
      for (const c of campos) sugerido[c.clave] = sugerir(columnas, c.pistas, Object.values(sugerido))
      setMapeo(sugerido)
      setFilas(nuevas)
    } catch (e) {
      setError(mensaje(e, 'No se pudo leer el archivo.'))
    }
  }

  async function importar() {
    if (!filas) return
    setTrabajando(true)
    setError('')
    setResultado(null)
    try {
      setResultado(await ejecutar(filas, mapeo))
    } catch (e) {
      setError(mensaje(e, 'No se pudo importar.'))
    } finally {
      setTrabajando(false)
    }
  }

  const columnas = filas ? Object.keys(filas[0]) : []
  const completo = campos.every((c) => !c.obligatorio || mapeo[c.clave])

  return (
    <div className="flex flex-col gap-3 rounded border p-3">
      <label className="flex flex-col gap-1">
        {etiquetaArchivo}
        <input
          type="file"
          accept=".csv,.txt,text/csv"
          className={campo}
          onChange={(e) => {
            void alElegirArchivo(e.target.files?.[0])
            // Se vacía para que elegir de nuevo el mismo archivo (corregido, con el mismo nombre) vuelva a leerlo.
            e.target.value = ''
          }}
        />
      </label>
      {ayuda && <p className="text-sm text-slate-600">{ayuda}</p>}
      {filas && (
        <>
          <p className="text-slate-600">{filas.length} filas en el archivo. Elige qué columna es cada dato.</p>
          {campos.map((c) => (
            <label key={c.clave} className="flex flex-col gap-1">
              {c.etiqueta}
              <select
                className={campo}
                value={mapeo[c.clave] ?? ''}
                onChange={(e) => setMapeo({ ...mapeo, [c.clave]: e.target.value })}
              >
                <option value="">{c.obligatorio ? '— elige una columna —' : '— ninguna —'}</option>
                {columnas.map((col) => (
                  <option key={col} value={col}>
                    {col}
                  </option>
                ))}
              </select>
            </label>
          ))}
          {extra}
          <button className={boton} disabled={!completo || trabajando} onClick={() => void importar()}>
            {textoBoton}
          </button>
        </>
      )}
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      {resultado && (
        <div>
          <p className="font-semibold">{resultado.resumen}</p>
          {resultado.errores.length > 0 && (
            <>
              <p className="mt-2 text-red-700">
                {resultado.errores.length === 1 ? '1 fila no se importó:' : `${resultado.errores.length} filas no se importaron:`}
              </p>
              <ul aria-label="Errores de importación" className="list-disc pl-6 text-red-700">
                {resultado.errores.map((e, i) => (
                  <li key={i}>{e.fila > 0 ? `Fila ${e.fila}: ${e.motivo}` : e.motivo}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  )
}

/** "2 asignaciones nuevas, 1 actualizada, 0 sin cambios, 1 error." */
export function resumenAsignaciones(r: ResultadoGuardado, errores: number): string {
  const nuevas = r.creados === 1 ? '1 asignación nueva' : `${r.creados} asignaciones nuevas`
  const act = r.actualizados === 1 ? '1 actualizada' : `${r.actualizados} actualizadas`
  const err = errores === 1 ? '1 error' : `${errores} errores`
  return `${nuevas}, ${act}, ${r.sinCambios} sin cambios, ${err}.`
}
