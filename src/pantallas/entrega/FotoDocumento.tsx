import { useRef, useState } from 'react'
import type { Repo } from '../../data/repo'
import { ErrorEntrega, TIPOS_FOTO_DOCUMENTO } from '../../dominio/entrega'

const ERROR_SUBIR = 'No se pudo adjuntar la foto. La entrega ya quedó registrada; puedes intentarlo de nuevo.'
const ERROR_VER = 'No se pudo abrir la foto. Revisa tu conexión e inténtalo de nuevo.'

const botonClaro = 'min-h-14 rounded border-2 border-slate-300 bg-white px-4 py-3 text-lg font-semibold disabled:opacity-50'

/**
 * Foto opcional del documento firmado de un trabajo: adjuntarla (nunca es obligatoria; si falla, lo ya
 * registrado no se toca) y, si ya hay una, abrirla con una URL temporal.
 */
export default function FotoDocumento({
  repo, trabajoId, numero, rutaActual, alCambiar,
}: {
  repo: Repo
  trabajoId: string
  numero: number
  rutaActual?: string
  alCambiar?: () => void
}) {
  const entrada = useRef<HTMLInputElement>(null)
  const enCurso = useRef(false)
  const [ruta, setRuta] = useState(rutaActual)
  const [subiendo, setSubiendo] = useState(false)
  const [aviso, setAviso] = useState('')
  const [error, setError] = useState('')
  const [url, setUrl] = useState('')

  async function subir(archivo: File) {
    if (enCurso.current) return
    enCurso.current = true
    setSubiendo(true)
    setError('')
    setAviso('')
    try {
      setRuta(await repo.subirFotoDocumento(trabajoId, archivo))
      setUrl('')
      setAviso('Foto adjuntada.')
      alCambiar?.()
    } catch (e) {
      setError(e instanceof ErrorEntrega ? e.message : ERROR_SUBIR)
    } finally {
      enCurso.current = false
      setSubiendo(false)
    }
  }

  async function ver() {
    if (!ruta || enCurso.current) return
    enCurso.current = true
    setError('')
    try {
      setUrl(await repo.urlFotoDocumento(ruta))
    } catch (e) {
      setError(e instanceof ErrorEntrega ? e.message : ERROR_VER)
    } finally {
      enCurso.current = false
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <button type="button" className={botonClaro} disabled={subiendo} onClick={() => entrada.current?.click()}>
          {subiendo ? 'Subiendo…' : ruta ? 'Reemplazar foto del documento firmado' : 'Adjuntar foto del documento firmado'}
        </button>
        {ruta && (
          <button type="button" className={botonClaro} onClick={() => void ver()}>
            Ver foto del documento
          </button>
        )}
      </div>
      <input
        ref={entrada}
        type="file"
        accept={TIPOS_FOTO_DOCUMENTO.join(',')}
        className="sr-only"
        tabIndex={-1}
        aria-label={`Archivo de la foto del documento del trabajo ${numero}`}
        onChange={(e) => {
          const archivo = e.target.files?.[0]
          e.target.value = ''
          if (archivo) void subir(archivo)
        }}
      />
      {aviso && <p role="status" className="text-teal-800">{aviso}</p>}
      {error && <p role="alert" className="rounded bg-red-50 p-3 text-red-700">{error}</p>}
      {url && (
        <a href={url} target="_blank" rel="noopener noreferrer" className="block">
          <img src={url} alt={`Foto del documento del trabajo ${numero}`} className="max-h-64 rounded border" />
          <span className="text-teal-800 underline">Abrir foto en otra pestaña</span>
        </a>
      )}
    </div>
  )
}
