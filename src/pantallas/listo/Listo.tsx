import { useEffect, useMemo, useState } from 'react'
import type { Repo } from '../../data/repo'
import { diaLocal } from '../../dominio/fechas'
import { resumenListo, type FilaListo } from '../../dominio/listo'
import type { Area } from '../../dominio/tipos'
import { crearDebounce } from './debounce'

const ESPERA_RECARGA_MS = 400

const DIAS: Record<number, string> = { 1: 'Lunes', 2: 'Martes', 3: 'Miércoles', 4: 'Jueves', 5: 'Viernes' }
const AREAS: Record<Area, string> = { afilado: 'Afilado', encuadernacion: 'Encuadernación' }
const SIN_RECORRIDO = '__sin_recorrido__'

const campo = 'min-h-12 w-full rounded border bg-white p-3 text-lg'

const formatoHora = new Intl.DateTimeFormat('es-CL', {
  timeZone: 'America/Santiago', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
})
const formatoSoloHora = new Intl.DateTimeFormat('es-CL', {
  timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
})

/** "hoy 10:30" o "24 nov, 10:30", siempre en hora de Chile. */
function desdeCuando(iso: string): string {
  const instante = new Date(iso)
  if (diaLocal(iso) === diaLocal(new Date().toISOString())) return `hoy ${formatoSoloHora.format(instante)}`
  return formatoHora.format(instante)
}

interface Grupo {
  clave: string
  titulo: string
  dia: number
  filas: FilaListo[]
}

function agrupar(filas: FilaListo[]): Grupo[] {
  const grupos = new Map<string, Grupo>()
  for (const f of filas) {
    const clave = f.recorrido ?? SIN_RECORRIDO
    let g = grupos.get(clave)
    if (!g) {
      const titulo = f.recorrido === null ? 'Sin recorrido' : f.dia ? `${f.recorrido} · ${DIAS[f.dia] ?? ''}` : f.recorrido
      g = { clave, titulo, dia: f.dia ?? 99, filas: [] }
      grupos.set(clave, g)
    }
    g.filas.push(f)
  }
  const cuando = (f: FilaListo) => (f.listoDesde ? Date.parse(f.listoDesde) : Infinity)
  for (const g of grupos.values()) {
    g.filas.sort((a, b) => cuando(a) - cuando(b) || a.clienteNombre.localeCompare(b.clienteNombre, 'es') || a.numero - b.numero)
  }
  return [...grupos.values()].sort((a, b) => a.dia - b.dia || a.titulo.localeCompare(b.titulo, 'es'))
}

export default function Listo({ repo }: { repo: Repo }) {
  const [filas, setFilas] = useState<(FilaListo & { clienteId: string })[] | null>(null)
  const [error, setError] = useState('')
  const [area, setArea] = useState('')
  const [cliente, setCliente] = useState('')
  const [recorrido, setRecorrido] = useState('')
  const [dia, setDia] = useState('')
  const [soloListas, setSoloListas] = useState(false)
  const [conectado, setConectado] = useState(true)

  useEffect(() => {
    let activo = true
    let pedido = 0
    async function cargar() {
      const mio = ++pedido
      try {
        const datos = await repo.cargarTodo()
        if (!activo || mio !== pedido) return // se desmontó, o llegó una carga más nueva
        const clientePorTrabajo = new Map(datos.trabajos.map((t) => [t.id, t.clienteId]))
        setFilas(resumenListo(datos).map((f) => ({ ...f, clienteId: clientePorTrabajo.get(f.trabajoId) ?? '' })))
        setError('')
      } catch (e) {
        if (!activo || mio !== pedido) return
        setError(e instanceof Error ? e.message : 'No se pudo cargar la información.')
      }
    }
    // Los eventos llegan en ráfagas (un movimiento por línea): se juntan en una sola recarga.
    const recarga = crearDebounce(() => void cargar(), ESPERA_RECARGA_MS)
    // Primero la suscripción y luego la carga, para no perder cambios entre ambas.
    const cancelar = repo.suscribirCambios(recarga.llamar, (c) => activo && setConectado(c))
    void cargar()
    const alVolver = () => {
      if (document.visibilityState === 'visible') recarga.llamar()
    }
    document.addEventListener('visibilitychange', alVolver)
    return () => {
      activo = false
      recarga.cancelar()
      document.removeEventListener('visibilitychange', alVolver)
      cancelar()
    }
  }, [repo])

  const clientes = useMemo(() => {
    const m = new Map<string, string>()
    for (const f of filas ?? []) m.set(f.clienteId, f.clienteNombre)
    return [...m].sort((a, b) => a[1].localeCompare(b[1], 'es'))
  }, [filas])
  const recorridos = useMemo(
    () => [...new Set((filas ?? []).flatMap((f) => (f.recorrido ? [f.recorrido] : [])))].sort((a, b) => a.localeCompare(b, 'es')),
    [filas],
  )

  const visibles = (filas ?? []).filter(
    (f) =>
      (!area || f.area === area) &&
      (!cliente || f.clienteId === cliente) &&
      (!recorrido || (recorrido === SIN_RECORRIDO ? f.recorrido === null : f.recorrido === recorrido)) &&
      (!dia || f.dia === Number(dia)) &&
      (!soloListas || f.listas > 0),
  )
  const grupos = agrupar(visibles)

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <label className="flex flex-col gap-1">
          Área
          <select className={campo} value={area} onChange={(e) => setArea(e.target.value)}>
            <option value="">Todas</option>
            <option value="afilado">Afilado</option>
            <option value="encuadernacion">Encuadernación</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Cliente
          <select className={campo} value={cliente} onChange={(e) => setCliente(e.target.value)}>
            <option value="">Todos</option>
            {clientes.map(([id, nombre]) => (
              <option key={id} value={id}>{nombre}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Recorrido
          <select className={campo} value={recorrido} onChange={(e) => setRecorrido(e.target.value)}>
            <option value="">Todos</option>
            {recorridos.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
            <option value={SIN_RECORRIDO}>Sin recorrido</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Día
          <select className={campo} value={dia} onChange={(e) => setDia(e.target.value)}>
            <option value="">Todos</option>
            {Object.entries(DIAS).map(([n, nombre]) => (
              <option key={n} value={n}>{nombre}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="flex min-h-12 items-center gap-3 text-lg">
        <input type="checkbox" className="h-6 w-6" checked={soloListas} onChange={(e) => setSoloListas(e.target.checked)} />
        Solo con unidades listas
      </label>

      {!conectado && <p role="status" className="text-sm text-amber-700">Reconectando…</p>}
      {error && <p role="alert" className="rounded bg-red-50 p-3 text-red-700">{error}</p>}
      {filas === null && !error && <p>Cargando…</p>}
      {filas !== null && grupos.length === 0 && (
        <p className="text-slate-600">No hay trabajos en curso que coincidan con los filtros.</p>
      )}

      {grupos.map((g) => (
        <section key={g.clave} className="flex flex-col gap-2">
          <h2 className="text-xl font-bold">{g.titulo}</h2>
          <ul className="flex flex-col gap-2">
            {g.filas.map((f) => {
              const completo = f.pendientes > 0 && f.listas === f.pendientes
              return (
                <li key={f.trabajoId} className={`rounded border-l-8 bg-white p-3 shadow-sm ${f.listas > 0 ? 'border-teal-600' : 'border-slate-300'}`}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-lg font-semibold">{f.clienteNombre}</span>
                    <span className="text-sm text-slate-600">Trabajo N.º {f.numero} · {AREAS[f.area]}</span>
                  </div>
                  <p className={`text-xl font-bold ${f.listas > 0 ? 'text-teal-800' : 'text-slate-600'}`}>
                    {f.listas} de {f.pendientes} listas
                  </p>
                  <p className="text-slate-700">
                    {f.listoDesde ? `${completo ? 'Todo listo' : 'Listo'} desde ${desdeCuando(f.listoDesde)}` : 'Aún no hay unidades listas'}
                  </p>
                  {f.entregadas > 0 && (
                    <p className="text-sm text-slate-600">
                      {f.entregadas} {f.entregadas === 1 ? 'entregada' : 'entregadas'} · {f.total} en el pedido
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}
