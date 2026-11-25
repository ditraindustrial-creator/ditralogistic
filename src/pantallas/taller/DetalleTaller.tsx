import { useRef, useState } from 'react'
import type { Repo } from '../../data/repo'
import {
  DETALLE_MAXIMO, ErrorPlanificacion, etiquetaPlanificada, SERVICIO_MAXIMO, type ParcialNueva, type PlanTrabajo,
} from '../../dominio/planificacion'
import { parsearCantidad } from '../../dominio/trabajo'

const campo = 'min-h-12 w-full min-w-0 rounded border p-3 text-lg'
const botonGuardar = 'min-h-12 rounded bg-slate-800 px-4 py-2 text-lg font-semibold text-white disabled:opacity-50'
const botonClaro = 'min-h-12 rounded border-2 border-slate-300 bg-white px-4 py-2 text-lg'

function mensajeDe(e: unknown, generico: string): string {
  return e instanceof ErrorPlanificacion ? e.message : generico
}

/**
 * Servicio y detalle técnico de una línea, que define el taller (el chofer solo anotó la herramienta).
 * `servicios`: nombres del catálogo (tipo servicio) del área, solo como sugerencia.
 */
export function DetalleLinea({
  repo, lineaId, servicio, detalle, servicios, alGuardar,
}: {
  repo: Repo
  lineaId: string
  servicio?: string
  detalle?: string
  servicios: string[]
  alGuardar: () => Promise<void> | void
}) {
  const [s, setS] = useState(servicio ?? '')
  const [d, setD] = useState(detalle ?? '')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const [ok, setOk] = useState('')
  const enCurso = useRef(false)
  const lista = `servicios-${lineaId}`

  async function guardar() {
    if (enCurso.current) return
    enCurso.current = true
    setGuardando(true)
    setError('')
    setOk('')
    try {
      await repo.guardarDetalleLinea(lineaId, { servicio: s, detalle: d })
      setOk('Detalle guardado')
      await alGuardar()
    } catch (e) {
      setError(mensajeDe(e, 'No se pudo guardar el detalle. Revisa tu conexión e inténtalo de nuevo.'))
    } finally {
      enCurso.current = false
      setGuardando(false)
    }
  }

  return (
    <fieldset className="flex flex-col gap-2 rounded bg-slate-50 p-3">
      <legend className="text-lg font-semibold">Detalle del taller</legend>
      <label className="flex flex-col gap-1">
        Servicio
        <input
          className={campo}
          list={lista}
          maxLength={SERVICIO_MAXIMO}
          placeholder="Ej.: afilado recto"
          value={s}
          onChange={(e) => setS(e.target.value)}
        />
      </label>
      <datalist id={lista}>
        {servicios.map((n) => <option key={n} value={n} />)}
      </datalist>
      <label className="flex flex-col gap-1">
        Detalle técnico
        <textarea
          className={`${campo} min-h-20`}
          maxLength={DETALLE_MAXIMO}
          placeholder="Ángulo, melladura, dientes, terminación…"
          value={d}
          onChange={(e) => setD(e.target.value)}
        />
      </label>
      {error && <p role="alert" className="rounded bg-red-50 p-3 text-red-700">{error}</p>}
      {ok && <p role="status" className="text-teal-800">{ok}</p>}
      <button type="button" className={botonGuardar} disabled={guardando} onClick={() => void guardar()}>
        {guardando ? 'Guardando…' : 'Guardar detalle'}
      </button>
    </fieldset>
  )
}

interface ParcialForm {
  clave: number
  planificada: string
  cantidad: string
  nota: string
}

/**
 * Horas planificadas de entrega de un trabajo de encuadernación: la del trabajo completo y una por
 * cada entrega parcial (con cantidad y nota opcionales). Guardar reemplaza el plan completo.
 */
export function PlanEntrega({
  repo, trabajoId, numero, plan, alGuardar,
}: {
  repo: Repo
  trabajoId: string
  numero: number
  plan?: PlanTrabajo
  alGuardar: () => Promise<void> | void
}) {
  const siguiente = useRef(1)
  const [entrega, setEntrega] = useState(plan?.entrega ?? '')
  const [parciales, setParciales] = useState<ParcialForm[]>(() =>
    (plan?.parciales ?? []).map((p) => ({
      clave: siguiente.current++, planificada: p.planificada, cantidad: p.cantidad ? String(p.cantidad) : '', nota: p.nota ?? '',
    })),
  )
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const [ok, setOk] = useState('')
  const enCurso = useRef(false)

  function cambiar(clave: number, cambios: Partial<ParcialForm>) {
    setParciales((ps) => ps.map((p) => (p.clave === clave ? { ...p, ...cambios } : p)))
  }

  async function guardar() {
    if (enCurso.current) return
    setError('')
    setOk('')
    const lista: ParcialNueva[] = []
    for (const [i, p] of parciales.entries()) {
      if (p.planificada === '') {
        setError(`Falta la fecha y hora de la entrega parcial ${i + 1}.`)
        return
      }
      const x: ParcialNueva = { planificada: p.planificada }
      if (p.cantidad.trim() !== '') {
        const n = parsearCantidad(p.cantidad)
        if (!Number.isInteger(n) || n <= 0) {
          setError(`La cantidad de la entrega parcial ${i + 1} debe ser un número entero mayor que cero.`)
          return
        }
        x.cantidad = n
      }
      if (p.nota.trim()) x.nota = p.nota
      lista.push(x)
    }
    enCurso.current = true
    setGuardando(true)
    try {
      await repo.planificarEntregas(trabajoId, { entrega: entrega || undefined, parciales: lista })
      setOk('Planificación guardada')
      await alGuardar()
    } catch (e) {
      setError(mensajeDe(e, 'No se pudo guardar la planificación. Revisa tu conexión e inténtalo de nuevo.'))
    } finally {
      enCurso.current = false
      setGuardando(false)
    }
  }

  return (
    <fieldset className="flex flex-col gap-3 rounded bg-amber-50 p-3">
      <legend className="text-lg font-semibold">Entrega planificada · Trabajo N.º {numero}</legend>
      <label className="flex flex-col gap-1">
        Trabajo completo
        <input type="datetime-local" className={campo} value={entrega} onChange={(e) => setEntrega(e.target.value)} />
      </label>
      {parciales.length > 0 && (
        <ol className="flex flex-col gap-3">
          {parciales.map((p, i) => (
            <li key={p.clave} className="flex flex-col gap-2 rounded border bg-white p-2">
              <span className="font-semibold">
                Entrega parcial {i + 1}
                {p.planificada ? ` · ${etiquetaPlanificada(p.planificada)}` : ''}
              </span>
              <label className="flex flex-col gap-1">
                Fecha y hora
                <input
                  type="datetime-local"
                  aria-label={`Fecha y hora parcial ${i + 1}`}
                  className={campo}
                  value={p.planificada}
                  onChange={(e) => cambiar(p.clave, { planificada: e.target.value })}
                />
              </label>
              <div className="flex gap-2">
                <label className="flex w-28 flex-col gap-1">
                  Cantidad
                  <input
                    inputMode="numeric"
                    aria-label={`Cantidad parcial ${i + 1}`}
                    className={campo}
                    value={p.cantidad}
                    onChange={(e) => cambiar(p.clave, { cantidad: e.target.value })}
                  />
                </label>
                <label className="flex flex-1 flex-col gap-1">
                  Nota
                  <input
                    aria-label={`Nota parcial ${i + 1}`}
                    className={campo}
                    maxLength={200}
                    value={p.nota}
                    onChange={(e) => cambiar(p.clave, { nota: e.target.value })}
                  />
                </label>
              </div>
              <button
                type="button"
                className={botonClaro}
                onClick={() => setParciales((ps) => ps.filter((x) => x.clave !== p.clave))}
              >
                Quitar entrega parcial {i + 1}
              </button>
            </li>
          ))}
        </ol>
      )}
      <button
        type="button"
        className={botonClaro}
        onClick={() => setParciales((ps) => [...ps, { clave: siguiente.current++, planificada: '', cantidad: '', nota: '' }])}
      >
        Agregar entrega parcial
      </button>
      {error && <p role="alert" className="rounded bg-red-50 p-3 text-red-700">{error}</p>}
      {ok && <p role="status" className="text-teal-800">{ok}</p>}
      <button type="button" className={botonGuardar} disabled={guardando} onClick={() => void guardar()}>
        {guardando ? 'Guardando…' : 'Guardar planificación'}
      </button>
    </fieldset>
  )
}
