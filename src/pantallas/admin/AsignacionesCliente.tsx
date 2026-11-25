import { useState } from 'react'
import type { Repo } from '../../data/repo'
import { siguienteOrden, validarAsignacion } from '../../dominio/maestros'
import type { Asignacion, Cliente, Recorrido } from '../../dominio/tipos'
import { mensaje } from './Importador'
import { etiquetaRecorrido } from './PestanaRecorridos'

const botonClaro = 'min-h-12 rounded border px-4 py-3 text-lg disabled:opacity-50'
const campo = 'min-h-12 rounded border p-3 text-lg'

/**
 * Recorridos de un cliente (uno por fila: fijo o a pedido, y su orden de visita), con agregar y
 * quitar. Sin `editable` (roles que no son de gestión) solo se listan.
 */
export default function AsignacionesCliente({
  repo, cliente, recorridos, asignaciones, editable, recargar,
}: {
  repo: Repo
  cliente: Cliente
  recorridos: Recorrido[]
  /** Todas las asignaciones (para calcular el orden de un cliente nuevo en un recorrido). */
  asignaciones: Asignacion[]
  editable: boolean
  recargar: () => Promise<void>
}) {
  const [nuevo, setNuevo] = useState('')
  const [error, setError] = useState('')
  const [ocupado, setOcupado] = useState(false)

  const recorridoPorId = new Map(recorridos.map((r) => [r.id, r]))
  const propias = asignaciones
    .filter((a) => a.clienteId === cliente.id && recorridoPorId.has(a.recorridoId))
    .map((a) => ({ a, r: recorridoPorId.get(a.recorridoId)! }))
    .sort((x, y) => x.r.dia - y.r.dia || x.r.nombre.localeCompare(y.r.nombre, 'es'))
  const disponibles = recorridos.filter((r) => !propias.some((p) => p.r.id === r.id))

  async function hacer(accion: () => Promise<unknown>) {
    if (ocupado) return
    setOcupado(true)
    setError('')
    try {
      await accion()
      await recargar()
    } catch (e) {
      setError(mensaje(e, 'No se pudo guardar.'))
    } finally {
      setOcupado(false)
    }
  }

  function guardar(a: Asignacion) {
    const invalido = validarAsignacion(a)
    if (invalido) return setError(invalido)
    void hacer(() => repo.guardarAsignaciones([a]))
  }

  return (
    <div role="group" aria-label={`Recorridos de ${cliente.nombre}`} className="flex flex-col gap-2">
      {propias.length === 0 ? (
        <p className="text-slate-600">Sin recorrido.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {propias.map(({ a, r }) =>
            editable ? (
              <FilaAsignacion
                key={`${r.id}-${a.orden}`}
                a={a}
                r={r}
                cliente={cliente}
                ocupado={ocupado}
                alGuardar={guardar}
                alQuitar={() => void hacer(() => repo.quitarAsignacion(cliente.id, r.id))}
              />
            ) : (
              <li key={r.id} className="text-slate-700">{`${etiquetaRecorrido(r)} · ${a.fija ? 'fijo' : 'a pedido'} · orden ${a.orden}`}</li>
            ),
          )}
        </ul>
      )}
      {editable && disponibles.length > 0 && (
        <div className="flex flex-wrap items-end gap-2">
          <select
            aria-label={`Agregar ${cliente.nombre} a un recorrido`}
            className={`${campo} flex-1`}
            value={nuevo}
            onChange={(e) => setNuevo(e.target.value)}
          >
            <option value="">— agregar a un recorrido —</option>
            {disponibles.map((r) => (
              <option key={r.id} value={r.id}>
                {etiquetaRecorrido(r)}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={botonClaro}
            disabled={nuevo === '' || ocupado}
            onClick={() => {
              const recorridoId = nuevo
              setNuevo('')
              // Entra como fijo, al final del recorrido; el orden y "a pedido" se cambian después.
              guardar({ clienteId: cliente.id, recorridoId, fija: true, orden: siguienteOrden(asignaciones, recorridoId) })
            }}
          >
            Agregar
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
    </div>
  )
}

function FilaAsignacion({
  a, r, cliente, ocupado, alGuardar, alQuitar,
}: {
  a: Asignacion
  r: Recorrido
  cliente: Cliente
  ocupado: boolean
  alGuardar: (a: Asignacion) => void
  alQuitar: () => void
}) {
  // El padre cambia la `key` cuando cambia el orden guardado, así el campo vuelve a ese valor.
  const [orden, setOrden] = useState(String(a.orden))

  return (
    <li className="flex flex-wrap items-center gap-3 rounded bg-slate-50 p-2">
      <span className="flex-1 font-semibold">{etiquetaRecorrido(r)}</span>
      <label className="flex min-h-12 items-center gap-2">
        <input
          type="checkbox"
          className="h-6 w-6"
          aria-label={`Fijo en ${r.nombre}`}
          checked={a.fija}
          disabled={ocupado}
          onChange={(e) => alGuardar({ ...a, fija: e.target.checked })}
        />
        {a.fija ? 'fijo' : 'a pedido'}
      </label>
      <label className="flex items-center gap-2">
        Orden
        <input
          type="number"
          inputMode="numeric"
          min={0}
          step={1}
          className={`${campo} w-24`}
          aria-label={`Orden en ${r.nombre}`}
          value={orden}
          disabled={ocupado}
          onChange={(e) => setOrden(e.target.value)}
          onBlur={() => {
            if (orden.trim() === String(a.orden)) return
            const n = orden.trim() === '' ? NaN : Number(orden)
            alGuardar({ ...a, orden: n })
          }}
        />
      </label>
      <button type="button" className={botonClaro} aria-label={`Quitar ${cliente.nombre} de ${r.nombre}`} disabled={ocupado} onClick={alQuitar}>
        Quitar
      </button>
    </li>
  )
}
