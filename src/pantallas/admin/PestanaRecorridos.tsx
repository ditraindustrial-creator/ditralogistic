import { useState, type FormEvent } from 'react'
import type { Repo } from '../../data/repo'
import { nombreRecorrido } from '../../dominio/maestros'
import type { Recorrido } from '../../dominio/tipos'
import { mensaje } from './Importador'

export const DIAS: Record<number, string> = { 1: 'Lunes', 2: 'Martes', 3: 'Miércoles', 4: 'Jueves', 5: 'Viernes' }

const boton = 'min-h-12 rounded bg-teal-700 px-5 py-3 text-lg font-semibold text-white disabled:opacity-50'
const botonClaro = 'min-h-12 rounded border px-4 py-3 text-lg'
const campo = 'min-h-12 rounded border p-3 text-lg'

/** "Lunes · Rodrigo Lagos (Lunes, lejano)": cómo se nombra un recorrido en las listas para elegir. */
export function etiquetaRecorrido(r: Recorrido): string {
  return `${r.nombre} (${DIAS[r.dia]}${r.lejano ? ', lejano' : ''})`
}

/**
 * Crear y editar recorridos (un día + un chofer titular). Para cargar rápido la semana: al crear uno,
 * se conservan chofer, camioneta y "lejano", el día pasa al siguiente y, con el nombre vacío, el
 * recorrido se llama "Día · Chofer".
 */
export default function PestanaRecorridos({ repo, recorridos, recargar }: { repo: Repo; recorridos: Recorrido[]; recargar: () => Promise<void> }) {
  const [editando, setEditando] = useState<string | null>(null)
  const [nombre, setNombre] = useState('')
  const [dia, setDia] = useState<Recorrido['dia']>(1)
  const [camioneta, setCamioneta] = useState('')
  const [chofer, setChofer] = useState('')
  const [lejano, setLejano] = useState(false)
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)

  function limpiar() {
    setEditando(null)
    setNombre('')
    setDia(1)
    setCamioneta('')
    setChofer('')
    setLejano(false)
  }

  async function guardar(e: FormEvent) {
    e.preventDefault()
    if (guardando) return
    setError('')
    const elNombre = nombreRecorrido(nombre, dia, chofer)
    if (elNombre === '') return setError('Escribe el nombre del recorrido.')
    if (camioneta.trim() === '') return setError('Escribe la camioneta del recorrido.')
    setGuardando(true)
    try {
      await repo.guardarRecorrido({
        id: editando ?? undefined, nombre: elNombre, dia, camioneta: camioneta.trim(), lejano, chofer: chofer.trim() || undefined,
      })
      if (editando) limpiar()
      else {
        // Listo para el siguiente día del mismo chofer.
        setNombre('')
        if (dia < 5) setDia((dia + 1) as Recorrido['dia'])
      }
      await recargar()
    } catch (err) {
      setError(mensaje(err, 'No se pudo guardar el recorrido.'))
    } finally {
      setGuardando(false)
    }
  }

  const choferes = [...new Set(recorridos.flatMap((r) => (r.chofer ? [r.chofer] : [])))]

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={(e) => void guardar(e)} className="flex flex-col gap-3 rounded border p-3">
        <label className="flex flex-col gap-1">
          Nombre del recorrido
          <input className={campo} value={nombre} onChange={(e) => setNombre(e.target.value)} />
        </label>
        <p className="text-sm text-slate-600">Si dejas el nombre vacío y anotas el chofer, se llama «Día · Chofer» (por ejemplo «Lunes · Rodrigo Lagos»).</p>
        <label className="flex flex-col gap-1">
          Día
          <select className={campo} value={dia} onChange={(e) => setDia(Number(e.target.value) as Recorrido['dia'])}>
            {Object.entries(DIAS).map(([n, t]) => (
              <option key={n} value={n}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Chofer titular (opcional)
          <input className={campo} value={chofer} onChange={(e) => setChofer(e.target.value)} list="choferes" maxLength={120} />
          <datalist id="choferes">
            {choferes.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </label>
        <label className="flex flex-col gap-1">
          Camioneta
          <input className={campo} value={camioneta} onChange={(e) => setCamioneta(e.target.value)} list="camionetas" />
          <datalist id="camionetas">
            <option value="Camioneta 1" />
            <option value="Camioneta 2" />
            <option value="Emergencia" />
          </datalist>
        </label>
        <label className="flex min-h-12 items-center gap-3 text-lg">
          <input type="checkbox" className="h-6 w-6" checked={lejano} onChange={(e) => setLejano(e.target.checked)} />
          Lejano
        </label>
        {error && (
          <p role="alert" className="text-red-700">
            {error}
          </p>
        )}
        <div className="flex gap-3">
          <button type="submit" className={boton} disabled={guardando}>
            Guardar recorrido
          </button>
          {editando && (
            <button type="button" className={botonClaro} onClick={limpiar}>
              Cancelar
            </button>
          )}
        </div>
      </form>
      {recorridos.length === 0 ? (
        <p className="text-slate-600">Aún no hay recorridos.</p>
      ) : (
        <ul aria-label="Recorridos" className="flex flex-col gap-3">
          {recorridos.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-2 rounded border p-3">
              <span>{`${r.nombre} · ${DIAS[r.dia]} · ${r.camioneta}${r.chofer ? ` · Chofer: ${r.chofer}` : ''}${r.lejano ? ' · lejano' : ''}`}</span>
              <button
                className={botonClaro}
                aria-label={`Editar ${r.nombre}`}
                onClick={() => {
                  setEditando(r.id)
                  setNombre(r.nombre)
                  setDia(r.dia)
                  setCamioneta(r.camioneta)
                  setChofer(r.chofer ?? '')
                  setLejano(r.lejano)
                }}
              >
                Editar
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
