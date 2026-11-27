import { useCallback, useEffect, useState } from 'react'
import type { Repo } from '../../data/repo'
import type { DatosOperacion } from '../../dominio/listo'
import type { UsuarioActual } from '../../dominio/tipos'
import { trabajosEnRecepcion } from '../../dominio/trabajo'
import Recepcion, { type EdicionTrabajo } from './Recepcion'
import { COLOR_AREA } from '../colorArea'
import { COLOR_FASE } from '../colorEtapa'

const MAX_VISIBLES = 30
const campo = 'min-h-12 w-full rounded border p-3 text-lg'

function plano(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/**
 * Lista de trabajos que siguen enteros en Recepción (ninguna pieza pasó al taller) para editarlos.
 * Solo gestión (el acceso lo decide PantallaRecepcion con puedeEditarRecepcion).
 */
export default function EditarRecibidos({ repo, usuario }: { repo: Repo; usuario: UsuarioActual }) {
  const [datos, setDatos] = useState<DatosOperacion | null>(null)
  const [error, setError] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [editando, setEditando] = useState<EdicionTrabajo | null>(null)

  const cargar = useCallback(async () => {
    try {
      setDatos(await repo.cargarTodo())
      setError('')
    } catch {
      setError('No se pudieron cargar los trabajos. Revisa tu conexión.')
    }
  }, [repo])

  useEffect(() => {
    void cargar()
  }, [cargar])

  if (editando) {
    return (
      <Recepcion
        key={editando.trabajo.id}
        repo={repo}
        usuario={usuario}
        edicion={editando}
        onEditado={() => {
          setEditando(null)
          void cargar()
        }}
        alCancelar={() => setEditando(null)}
      />
    )
  }

  if (error) return <p role="alert" className="text-red-700">{error}</p>
  if (!datos) return <p>Cargando…</p>

  const clientes = new Map(datos.clientes.map((c) => [c.id, c]))
  const q = plano(busqueda.trim()).replace(/^n\.?\s*º?\s*/, '')
  const lista = trabajosEnRecepcion(datos.trabajos, datos.lineas, datos.movimientos).filter((t) => {
    if (q === '') return true
    const c = clientes.get(t.clienteId)
    return String(t.numero) === q || (c !== undefined && (plano(c.nombre).includes(q) || plano(c.rut).includes(q)))
  })

  return (
    <div className="flex flex-col gap-4">
      <p className="text-slate-700">
        Aquí están los trabajos cuyas piezas siguen todas en Recepción. Cuando alguna pieza pasa al taller, el trabajo ya no se puede editar.
      </p>
      <label className="flex flex-col gap-1 text-lg font-semibold">
        Buscar trabajo
        <input
          type="search"
          autoComplete="off"
          placeholder="N.º de trabajo, cliente o RUT"
          className={`${campo} font-normal`}
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
        />
      </label>
      {lista.length === 0 ? (
        <p className="text-slate-600">{busqueda.trim() ? 'No hay trabajos en Recepción que coincidan.' : 'No hay trabajos en Recepción.'}</p>
      ) : (
        <ul aria-label="Trabajos en Recepción" className="flex flex-col gap-2">
          {lista.slice(0, MAX_VISIBLES).map((t) => {
            const c = clientes.get(t.clienteId)
            const suyas = datos.lineas.filter((l) => l.trabajoId === t.id)
            return (
              <li key={t.id} className={`flex items-center justify-between gap-2 rounded border-l-8 p-3 ${COLOR_AREA[t.area].borde} ${COLOR_AREA[t.area].fondo}`}>
                <div className="min-w-0">
                  <p className="text-lg font-semibold">
                    N.º {t.numero} · {c?.nombre ?? 'Cliente desconocido'}
                    <span className={`ml-2 ${COLOR_FASE.recibido.etiqueta}`}>Recibido</span>
                  </p>
                  <p className="text-sm text-slate-700">
                    {t.area === 'afilado' ? 'Afilado' : 'Encuadernación'} · {suyas.map((l) => `${l.cantidad} ${l.producto}`).join(', ')}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label={`Editar trabajo ${t.numero}`}
                  className="min-h-12 shrink-0 rounded bg-teal-700 px-4 py-2 text-lg font-semibold text-white"
                  onClick={() => setEditando({ trabajo: t, lineas: suyas, cliente: c })}
                >
                  Editar
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {lista.length > MAX_VISIBLES && <p className="text-slate-600">Mostrando {MAX_VISIBLES} de {lista.length}. Busca por número o cliente.</p>}
    </div>
  )
}
