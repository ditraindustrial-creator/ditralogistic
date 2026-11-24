import { useMemo, useRef, useState } from 'react'
import type { Repo } from '../../data/repo'
import { ErrorMovimiento, validarMovimiento } from '../../dominio/avance'
import { puedeVer } from '../../dominio/permisos'
import { areasDelRol, lineasEnCurso, type LineaTaller } from '../../dominio/taller'
import type { Area, UsuarioActual } from '../../dominio/tipos'
import { useDatosEnVivo } from '../useDatosEnVivo'

const AREAS: Record<Area, string> = { afilado: 'Afilado', encuadernacion: 'Encuadernación' }
const ERROR_GENERICO = 'No se pudo mover las unidades. Revisa tu conexión e inténtalo de nuevo.'

const botonGrande = 'min-h-14 rounded bg-teal-700 px-5 py-3 text-xl font-semibold text-white disabled:opacity-50'
const botonClaro = 'min-h-14 min-w-14 rounded border-2 border-slate-300 bg-white px-4 py-3 text-2xl font-semibold'

interface Seleccion {
  lineaId: string
  origenId: string
  destinoId: string
  cantidad: string
}

function unidades(n: number) {
  return `${n} ${n === 1 ? 'unidad' : 'unidades'}`
}

/** Etapa de origen por defecto: la primera (en orden) con unidades que no sea final. */
function origenPorDefecto(l: LineaTaller): string {
  return (l.distribucion.find((d) => !d.etapa.esFinal) ?? l.distribucion[0]).etapa.id
}

/** Destino por defecto: la etapa siguiente del área (o la anterior si el origen es la última). */
function destinoPorDefecto(l: LineaTaller, origenId: string): string {
  const i = l.etapasArea.findIndex((e) => e.id === origenId)
  return (l.etapasArea[i + 1] ?? l.etapasArea[i - 1] ?? l.etapasArea[0]).id
}

function disponibles(l: LineaTaller, origenId: string): number {
  return l.distribucion.find((d) => d.etapa.id === origenId)?.unidades ?? 0
}

function Opcion({ nombre, texto, marcada, alElegir }: { nombre: string; texto: string; marcada: boolean; alElegir: () => void }) {
  return (
    <label
      className={`flex min-h-14 cursor-pointer items-center justify-center rounded border-2 px-4 py-2 text-center text-lg ${
        marcada ? 'border-teal-700 bg-teal-700 text-white' : 'border-slate-300 bg-white'
      }`}
    >
      <input type="radio" name={nombre} className="sr-only" checked={marcada} onChange={alElegir} />
      {texto}
    </label>
  )
}

export default function Taller({ repo, usuario, area }: { repo: Repo; usuario: UsuarioActual; area?: Area }) {
  const { datos, error: errorCarga, conectado, recargar } = useDatosEnVivo(repo)
  const enCurso = useRef(false)
  const [filtro, setFiltro] = useState<Area | ''>(area ?? '')
  const [sel, setSel] = useState<Seleccion | null>(null)
  const [moviendo, setMoviendo] = useState(false)
  const [errorMover, setErrorMover] = useState('')
  const [confirmacion, setConfirmacion] = useState('')

  const permitidas = useMemo(
    () => (puedeVer(usuario.rol, 'taller') ? areasDelRol(usuario.rol).filter((a) => !area || a === area) : []),
    [usuario.rol, area],
  )
  const areasVisibles = useMemo(
    () => (filtro && permitidas.includes(filtro) ? [filtro] : permitidas),
    [filtro, permitidas],
  )
  const lineas = useMemo(() => (datos ? lineasEnCurso(datos, areasVisibles) : null), [datos, areasVisibles])

  if (permitidas.length === 0) {
    return <p role="alert" className="text-red-700">No tienes acceso al taller.</p>
  }

  function abrir(l: LineaTaller) {
    setErrorMover('')
    setConfirmacion('')
    if (sel?.lineaId === l.lineaId) {
      setSel(null)
      return
    }
    const origenId = origenPorDefecto(l)
    setSel({ lineaId: l.lineaId, origenId, destinoId: destinoPorDefecto(l, origenId), cantidad: String(disponibles(l, origenId)) })
  }

  function cambiarOrigen(l: LineaTaller, origenId: string) {
    setSel({ lineaId: l.lineaId, origenId, destinoId: destinoPorDefecto(l, origenId), cantidad: String(disponibles(l, origenId)) })
  }

  function ajustar(l: LineaTaller, delta: number) {
    if (!sel) return
    const max = disponibles(l, sel.origenId)
    const actual = Number(sel.cantidad)
    const base = Number.isFinite(actual) ? actual : 0
    setSel({ ...sel, cantidad: String(Math.min(Math.max(base + delta, 1), Math.max(max, 1))) })
  }

  async function mover(l: LineaTaller) {
    if (enCurso.current || !sel) return
    const cantidad = sel.cantidad.trim() === '' ? NaN : Number(sel.cantidad)
    const destino = l.etapasArea.find((e) => e.id === sel.destinoId)
    try {
      const dist = new Map(l.distribucion.map((d) => [d.etapa.id, d.unidades]))
      validarMovimiento(dist, sel.origenId, cantidad)
    } catch (e) {
      setErrorMover(e instanceof ErrorMovimiento ? e.message : ERROR_GENERICO)
      return
    }
    setErrorMover('')
    enCurso.current = true
    setMoviendo(true)
    try {
      await repo.moverUnidades(l.lineaId, cantidad, sel.origenId, sel.destinoId)
      setConfirmacion(`${unidades(cantidad)} ${cantidad === 1 ? 'pasó' : 'pasaron'} a ${destino?.nombre ?? 'la etapa elegida'}`)
      setSel(null)
      await recargar()
    } catch (e) {
      // Solo se muestran tal cual los errores de regla (ya en español); lo demás es técnico.
      setErrorMover(e instanceof ErrorMovimiento ? e.message : ERROR_GENERICO)
    } finally {
      enCurso.current = false
      setMoviendo(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {permitidas.length > 1 && (
        <div className="flex gap-2" role="group" aria-label="Área">
          {(['', ...permitidas] as const).map((a) => (
            <button
              key={a || 'todas'}
              type="button"
              aria-pressed={filtro === a}
              className={`min-h-12 flex-1 rounded border-2 px-3 text-lg ${filtro === a ? 'border-teal-700 bg-teal-700 text-white' : 'border-slate-300 bg-white'}`}
              onClick={() => { setFiltro(a); setSel(null) }}
            >
              {a ? AREAS[a] : 'Todas'}
            </button>
          ))}
        </div>
      )}

      {confirmacion && (
        <p role="status" className="rounded bg-teal-50 p-4 text-xl font-bold text-teal-800">{confirmacion}</p>
      )}
      {!conectado && <p role="status" className="text-sm text-amber-700">Reconectando…</p>}
      {errorCarga && <p role="alert" className="rounded bg-red-50 p-3 text-red-700">{errorCarga}</p>}
      {lineas === null && !errorCarga && <p>Cargando…</p>}
      {lineas !== null && lineas.length === 0 && <p className="text-slate-600">No hay líneas en curso en el taller.</p>}

      <ul className="flex flex-col gap-3">
        {(lineas ?? []).map((l) => {
          const abierta = sel?.lineaId === l.lineaId
          const max = sel ? disponibles(l, sel.origenId) : 0
          return (
            <li key={l.lineaId} className={`rounded border-l-8 bg-white shadow-sm ${l.urgente ? 'border-red-600' : 'border-slate-300'}`}>
              <button
                type="button"
                aria-expanded={abierta}
                className="flex min-h-16 w-full flex-col gap-1 p-3 text-left"
                onClick={() => abrir(l)}
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="text-lg font-semibold">{l.clienteNombre}</span>
                  <span className="text-sm text-slate-600">
                    Trabajo N.º {l.numero}{permitidas.length > 1 ? ` · ${AREAS[l.area]}` : ''}
                  </span>
                </span>
                <span className="text-xl font-bold">{l.producto} · {l.cantidad}</span>
                {l.urgente && <span className="text-sm font-bold text-red-700">URGENTE</span>}
                <span className="flex flex-wrap gap-2">
                  {l.distribucion.map((d) => (
                    <span key={d.etapa.id} className="rounded bg-slate-100 px-2 py-1 text-base">
                      {d.etapa.nombre} {d.unidades}
                    </span>
                  ))}
                </span>
              </button>

              {abierta && sel && (
                <div className="flex flex-col gap-4 border-t p-3">
                  {l.distribucion.length > 1 && (
                    <fieldset className="flex flex-col gap-2">
                      <legend className="mb-1 text-lg font-semibold">Desde</legend>
                      <div className="grid grid-cols-2 gap-2">
                        {l.distribucion.map((d) => (
                          <Opcion
                            key={d.etapa.id}
                            nombre={`desde-${l.lineaId}`}
                            texto={`${d.etapa.nombre} (${d.unidades})`}
                            marcada={sel.origenId === d.etapa.id}
                            alElegir={() => cambiarOrigen(l, d.etapa.id)}
                          />
                        ))}
                      </div>
                    </fieldset>
                  )}

                  <fieldset className="flex flex-col gap-2">
                    <legend className="mb-1 text-lg font-semibold">Pasar a</legend>
                    <div className="grid grid-cols-2 gap-2">
                      {l.etapasArea.filter((e) => e.id !== sel.origenId).map((e) => (
                        <Opcion
                          key={e.id}
                          nombre={`destino-${l.lineaId}`}
                          texto={e.nombre}
                          marcada={sel.destinoId === e.id}
                          alElegir={() => setSel({ ...sel, destinoId: e.id })}
                        />
                      ))}
                    </div>
                  </fieldset>

                  <div className="flex flex-col gap-2">
                    <label htmlFor={`cant-${l.lineaId}`} className="text-lg font-semibold">Cantidad</label>
                    <div className="flex items-center gap-2">
                      <button type="button" className={botonClaro} aria-label="Menos" onClick={() => ajustar(l, -1)}>−</button>
                      <input
                        id={`cant-${l.lineaId}`}
                        inputMode="numeric"
                        autoComplete="off"
                        className="min-h-14 w-full min-w-0 rounded border p-3 text-center text-2xl"
                        value={sel.cantidad}
                        onChange={(e) => setSel({ ...sel, cantidad: e.target.value.replace(/\D/g, '') })}
                      />
                      <button type="button" className={botonClaro} aria-label="Más" onClick={() => ajustar(l, 1)}>+</button>
                      <button type="button" className={botonClaro} onClick={() => setSel({ ...sel, cantidad: String(max) })}>Todas</button>
                    </div>
                    <p className="text-sm text-slate-600">Disponibles en esta etapa: {max}</p>
                  </div>

                  {errorMover && <p role="alert" className="rounded bg-red-50 p-3 text-red-700">{errorMover}</p>}
                  <button type="button" className={botonGrande} disabled={moviendo} onClick={() => void mover(l)}>
                    {moviendo ? 'Moviendo…' : 'Mover'}
                  </button>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
