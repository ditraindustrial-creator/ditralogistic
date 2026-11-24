import { useRef, useState } from 'react'
import type { Repo } from '../../data/repo'
import { ErrorEntrega, validarEntradaEntrega, type Entrega as EntregaDatos, type LineaEntregable } from '../../dominio/entrega'
import FotoDocumento from './FotoDocumento'

const ERROR_GENERICO = 'No se pudo registrar la entrega. Revisa tu conexión e inténtalo de nuevo.'

const campo = 'min-h-14 w-full rounded border p-3 text-lg'
const botonGrande = 'min-h-14 rounded bg-teal-700 px-5 py-3 text-xl font-semibold text-white disabled:opacity-50'
const botonClaro = 'min-h-14 min-w-14 rounded border-2 border-slate-300 bg-white px-4 py-3 text-2xl font-semibold disabled:opacity-40'

export interface ResultadoEntrega {
  entregas: EntregaDatos[]
  documento: string
  unidades: number
  trabajos: { trabajoId: string; numero: number }[]
}

const unidades = (n: number) => `${n} ${n === 1 ? 'unidad' : 'unidades'}`
const aNumero = (s: string) => (s.trim() === '' ? NaN : Number(s))

/**
 * Flujo de entrega, compartido por la ruta, la hoja del chofer y el taller: se eligen líneas y
 * cantidades (nunca más de lo listo), se anota el N° de documento (guía o factura) y se llama una
 * vez a `entregarUnidades`. Tras entregar ofrece, sin obligar, adjuntar la foto del documento firmado.
 */
export default function Entrega({
  repo, lineas, titulo, alTerminar, alCerrar, cantidadesIniciales,
}: {
  repo: Repo
  lineas: LineaEntregable[]
  titulo?: string
  /** Se llama una vez registrada la entrega (p. ej. para recargar la pantalla). */
  alTerminar?: (resultado: ResultadoEntrega) => void
  alCerrar: () => void
  /** Cantidad inicial por línea (por defecto, todo lo listo). */
  cantidadesIniciales?: Record<string, number>
}) {
  const enCurso = useRef(false)
  const [editadas, setEditadas] = useState<Record<string, string>>({})
  const [desmarcadas, setDesmarcadas] = useState<ReadonlySet<string>>(new Set())
  const [documento, setDocumento] = useState('')
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [hecho, setHecho] = useState<ResultadoEntrega | null>(null)

  // La cantidad que se ve nunca pasa de lo listo, aunque lo listo baje mientras la pantalla está abierta.
  function cantidadTexto(l: LineaEntregable): string {
    const t = editadas[l.lineaId]
    if (t === undefined) return String(Math.min(Math.max(cantidadesIniciales?.[l.lineaId] ?? l.listas, 1), l.listas))
    if (t === '') return ''
    return String(Math.min(Number(t), l.listas))
  }
  const fijar = (l: LineaEntregable, valor: string) => setEditadas((e) => ({ ...e, [l.lineaId]: valor }))
  function ajustar(l: LineaEntregable, delta: number) {
    const base = aNumero(cantidadTexto(l))
    fijar(l, String(Math.min(Math.max((Number.isFinite(base) ? base : 0) + delta, 1), l.listas)))
  }
  function marcar(l: LineaEntregable, marcada: boolean) {
    setDesmarcadas((s) => {
      const n = new Set(s)
      if (marcada) n.delete(l.lineaId)
      else n.add(l.lineaId)
      return n
    })
  }

  async function entregar() {
    if (enCurso.current) return
    const elegidas = lineas.filter((l) => !desmarcadas.has(l.lineaId))
    const entregas = elegidas.map((l) => ({ lineaId: l.lineaId, cantidad: aNumero(cantidadTexto(l)) }))
    let doc: string
    try {
      doc = validarEntradaEntrega(entregas, documento)
    } catch (e) {
      setError(e instanceof ErrorEntrega ? e.message : ERROR_GENERICO)
      return
    }
    setError('')
    enCurso.current = true
    setEnviando(true)
    try {
      await repo.entregarUnidades(entregas, doc)
      const trabajos = [...new Map(elegidas.map((l) => [l.trabajoId, { trabajoId: l.trabajoId, numero: l.numero }])).values()]
      const resultado = { entregas, documento: doc, unidades: entregas.reduce((s, e) => s + e.cantidad, 0), trabajos }
      setHecho(resultado)
      alTerminar?.(resultado)
    } catch (e) {
      // Solo se muestran tal cual los errores de regla (ya en español); lo demás es técnico.
      setError(e instanceof ErrorEntrega ? e.message : ERROR_GENERICO)
    } finally {
      enCurso.current = false
      setEnviando(false)
    }
  }

  if (hecho) {
    return (
      <div className="flex flex-col gap-4 rounded border-2 border-teal-700 p-4">
        <p role="status" className="text-xl font-bold text-teal-800">
          Entrega registrada: {unidades(hecho.unidades)} · Guía {hecho.documento}
        </p>
        <p className="text-slate-600">Si tienes el documento firmado, puedes adjuntar una foto. No es obligatorio.</p>
        <ul className="flex flex-col gap-3">
          {hecho.trabajos.map((t) => (
            <li key={t.trabajoId} className="flex flex-col gap-2">
              <span className="font-semibold">Trabajo N.º {t.numero}</span>
              <FotoDocumento repo={repo} trabajoId={t.trabajoId} numero={t.numero} />
            </li>
          ))}
        </ul>
        <button type="button" className={botonGrande} onClick={alCerrar}>Listo</button>
      </div>
    )
  }

  const porTrabajo = new Map<string, LineaEntregable[]>()
  for (const l of lineas) porTrabajo.set(l.trabajoId, [...(porTrabajo.get(l.trabajoId) ?? []), l])

  return (
    <form
      className="flex flex-col gap-4 rounded border-2 border-teal-700 p-4"
      onSubmit={(e) => {
        e.preventDefault()
        void entregar()
      }}
    >
      {titulo && <h2 className="text-xl font-bold">{titulo}</h2>}
      {lineas.length === 0 ? (
        <p className="text-slate-700">No hay unidades listas para entregar.</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {[...porTrabajo.values()].map((ls) => (
            <li key={ls[0].trabajoId} className="flex flex-col gap-3">
              <span className="font-semibold">Trabajo N.º {ls[0].numero}</span>
              {ls.map((l) => {
                const marcada = !desmarcadas.has(l.lineaId)
                return (
                  <div key={l.lineaId} className="flex flex-col gap-2 rounded bg-slate-50 p-3">
                    <label className="flex min-h-14 items-center gap-3 text-lg">
                      <input
                        type="checkbox"
                        className="h-7 w-7"
                        aria-label={`Incluir ${l.producto}`}
                        checked={marcada}
                        onChange={(e) => marcar(l, e.target.checked)}
                      />
                      <span className="font-semibold">{l.producto}</span>
                      <span className="text-slate-600">({l.listas} {l.listas === 1 ? 'lista' : 'listas'})</span>
                    </label>
                    {marcada && (
                      <div className="flex items-center gap-2">
                        <button type="button" className={botonClaro} aria-label={`Menos ${l.producto}`} disabled={!(aNumero(cantidadTexto(l)) > 1)} onClick={() => ajustar(l, -1)}>−</button>
                        <input
                          inputMode="numeric"
                          autoComplete="off"
                          aria-label={`Cantidad ${l.producto}`}
                          className={`${campo} min-w-0 text-center text-2xl`}
                          value={cantidadTexto(l)}
                          onChange={(e) => fijar(l, e.target.value.replace(/\D/g, '').slice(0, 9))}
                        />
                        <button type="button" className={botonClaro} aria-label={`Más ${l.producto}`} disabled={aNumero(cantidadTexto(l)) >= l.listas} onClick={() => ajustar(l, 1)}>+</button>
                        <button type="button" className={`${botonClaro} text-lg`} aria-label={`Todo ${l.producto}`} onClick={() => fijar(l, String(l.listas))}>Todo</button>
                      </div>
                    )}
                  </div>
                )
              })}
            </li>
          ))}
        </ul>
      )}

      {lineas.length > 0 && (
        <label className="flex flex-col gap-1 text-lg font-semibold">
          N° de documento (guía o factura)
          <input
            className={`${campo} font-normal`}
            autoComplete="off"
            value={documento}
            onChange={(e) => setDocumento(e.target.value)}
          />
        </label>
      )}

      {error && <p role="alert" className="rounded bg-red-50 p-3 text-red-700">{error}</p>}
      <div className="flex flex-wrap gap-2">
        {lineas.length > 0 && (
          <button type="submit" className={botonGrande} disabled={enviando}>
            {enviando ? 'Entregando…' : 'Entregar'}
          </button>
        )}
        <button type="button" className="min-h-14 rounded border-2 border-slate-300 bg-white px-5 py-3 text-lg" onClick={alCerrar}>
          Cancelar
        </button>
      </div>
    </form>
  )
}
