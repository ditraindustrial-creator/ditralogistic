import { useMemo, useRef, useState } from 'react'
import type { Repo } from '../../data/repo'
import { lineasEntregables } from '../../dominio/entrega'
import { diaLocal, diaSemana } from '../../dominio/fechas'
import { resumenListo } from '../../dominio/listo'
import { armarRuta, ErrorVisita, fechaValida, ordenarParadas, recorridoDelChofer, type Confirmacion, type Parada } from '../../dominio/ruta'
import type { Cliente, UsuarioActual } from '../../dominio/tipos'
import Entrega from '../entrega/Entrega'
import Recepcion from '../recepcion/Recepcion'
import { useDatosEnVivo } from '../useDatosEnVivo'
import { useFechaPorDefecto } from '../useFechaPorDefecto'
import { agruparParadas, ControlVisita, ESTADO_VISITA, fechaLarga, InsigniaParada, Plegable, textoProductos, useVisitas } from './comun'

const ERROR_VISITA = 'No se pudo guardar la visita. Revisa tu conexión e inténtalo de nuevo.'
const elMismoDia = (hoy: string) => hoy

const campo = 'min-h-12 w-full rounded border bg-white p-3 text-lg'
const botonGrande = 'min-h-14 rounded bg-teal-700 px-5 py-3 text-xl font-semibold text-white disabled:opacity-50'
const botonClaro = 'min-h-14 rounded border-2 border-slate-300 bg-white px-5 py-3 text-xl font-semibold'

type Panel =
  | { tipo: 'entrega'; clienteNombre: string; trabajoIds: string[] }
  | { tipo: 'retiro'; cliente: Cliente; guardado: boolean }

export default function HojaChofer({ repo, usuario }: { repo: Repo; usuario: UsuarioActual }) {
  const { datos, error: errorCarga, conectado, recargar } = useDatosEnVivo(repo)
  // Hoy en Santiago; se recalcula si la app queda abierta de un día para otro (salvo fecha elegida).
  const [fecha, elegirFecha] = useFechaPorDefecto(elMismoDia)
  const { visitas, error: errorVisitas, recargar: recargarVisitas } = useVisitas(repo, fecha)
  const [elegido, setElegido] = useState('')
  const [panel, setPanel] = useState<Panel | null>(null)
  const [errorVisita, setErrorVisita] = useState('')
  const marcando = useRef(new Set<string>())
  const [, repintar] = useState(0)

  const ruta = useMemo(
    () =>
      datos && visitas
        ? armarRuta(fecha, resumenListo(datos, diaLocal(new Date().toISOString())), datos.clientes, datos.recorridos, datos.asignaciones, visitas)
        : null,
    [datos, visitas, fecha],
  )
  // Un grupo por recorrido con todas sus paradas: primero las de entregar y, aparte, las de pasar a retirar.
  const grupos = useMemo(
    () => agruparParadas(ordenarParadas([...(ruta?.paradas ?? []), ...(ruta?.pasarARetirar ?? [])]), datos?.recorridos ?? []),
    [ruta, datos],
  )
  // Por defecto, el recorrido de esa fecha cuyo chofer titular es quien inició sesión; si no, el primero.
  const delChofer = useMemo(() => recorridoDelChofer(datos?.recorridos ?? [], fecha, usuario.nombre)?.id, [datos, fecha, usuario.nombre])
  const grupo = grupos.find((g) => g.clave === elegido) ?? grupos.find((g) => g.clave === delChofer) ?? grupos[0]
  const trabajoPorId = useMemo(() => new Map((datos?.trabajos ?? []).map((t) => [t.id, t])), [datos])

  // El chofer marca la visita en terreno (RLS: de hoy en adelante). Una a la vez por cliente: un doble toque no duplica.
  async function marcar(p: Parada, valor: Confirmacion) {
    const clave = p.clienteId
    if (marcando.current.has(clave)) return
    marcando.current.add(clave)
    repintar((n) => n + 1)
    setErrorVisita('')
    try {
      await repo.marcarVisita(fecha, p.clienteId, valor)
      await recargarVisitas()
    } catch (e) {
      setErrorVisita(e instanceof ErrorVisita ? e.message : ERROR_VISITA)
    } finally {
      marcando.current.delete(clave)
      repintar((n) => n + 1)
    }
  }

  function tarjeta(p: Parada) {
    const cliente = datos?.clientes.find((c) => c.id === p.clienteId)
    return (
      <li key={p.clienteId} className="flex flex-col gap-3 rounded-lg border-l-8 border-teal-700 bg-white p-4 shadow">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-2xl font-bold">{p.clienteNombre}</h2>
          <InsigniaParada parada={p} />
        </div>
        {(p.requiereConfirmacion || p.solicitada) && (
          <p className={`text-lg font-semibold ${p.requiereConfirmacion && p.confirmada === 'no' ? 'text-red-700' : 'text-slate-700'}`}>
            {p.solicitada ? 'Visita extra · ' : ''}{p.requiereConfirmacion ? `Visita: ${ESTADO_VISITA[p.confirmada]}` : ''}
          </p>
        )}
        {p.nota && <p className="text-slate-700">Nota: {p.nota}</p>}
        <ControlVisita parada={p} ocupado={marcando.current.has(p.clienteId)} alMarcar={(c) => void marcar(p, c)} />

        {p.entregar.length === 0 ? (
          <p className="text-lg text-slate-600">Sin unidades listas para esta visita.</p>
        ) : (
          <>
            <p className="text-lg font-semibold">
              Todo lo listo: {p.entregar.map((f) => (datos ? textoProductos(datos, f.trabajoId) : '')).filter(Boolean).join(', ')}
            </p>
            <ul className="flex flex-col gap-3">
              {p.entregar.map((f) => {
                const t = trabajoPorId.get(f.trabajoId)
                return (
                  <li key={f.trabajoId} className="flex flex-col gap-2 rounded bg-slate-50 p-3">
                    <span className="text-lg">N.º {f.numero} · {datos ? textoProductos(datos, f.trabajoId) : `${f.listas} listas`}</span>
                    {t?.guiaDespacho && <span className="text-slate-700">Guía: {t.guiaDespacho}</span>}
                  </li>
                )
              })}
            </ul>
          </>
        )}

        <div className="flex flex-wrap gap-2">
          {p.entregar.length > 0 && (
            <button
              type="button"
              className={`${botonGrande} flex-1`}
              aria-label={`Entregar a ${p.clienteNombre}`}
              onClick={() => setPanel({ tipo: 'entrega', clienteNombre: p.clienteNombre, trabajoIds: p.entregar.map((f) => f.trabajoId) })}
            >
              Entregar
            </button>
          )}
          {cliente && (
            <button
              type="button"
              className={`${botonClaro} flex-1`}
              aria-label={`Registrar retiro de ${p.clienteNombre}`}
              onClick={() => setPanel({ tipo: 'retiro', cliente, guardado: false })}
            >
              Registrar retiro
            </button>
          )}
        </div>
      </li>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-lg font-semibold">
        Fecha
        <input
          type="date"
          className={`${campo} font-normal`}
          value={fecha}
          onChange={(e) => {
            if (fechaValida(e.target.value)) {
              elegirFecha(e.target.value)
              setPanel(null)
            }
          }}
        />
      </label>
      <p className="text-xl font-bold">Ruta del {fechaLarga(fecha)}</p>

      {panel?.tipo === 'entrega' && datos && (
        <Entrega
          key={panel.trabajoIds.join(',')}
          repo={repo}
          titulo={`Entregar a ${panel.clienteNombre}`}
          lineas={lineasEntregables(datos, panel.trabajoIds)}
          alTerminar={() => void recargar()}
          alCerrar={() => setPanel(null)}
        />
      )}
      {panel?.tipo === 'retiro' && (
        <div className="flex flex-col gap-3 rounded border-2 border-teal-700 p-3">
          <Recepcion repo={repo} usuario={usuario} clienteInicial={panel.cliente} onCreado={() => {
              setPanel((a) => (a?.tipo === 'retiro' ? { ...a, guardado: true } : a))
              void recargar()
            }}
          />
          <button type="button" className={botonClaro} onClick={() => setPanel(null)}>
            {panel.guardado ? 'Cerrar' : 'Cancelar'}
          </button>
        </div>
      )}

      {!conectado && <p role="status" className="text-sm text-amber-700">Reconectando…</p>}
      {errorCarga && <p role="alert" className="rounded bg-red-50 p-3 text-red-700">{errorCarga}</p>}
      {errorVisitas && <p role="alert" className="rounded bg-red-50 p-3 text-red-700">{errorVisitas}</p>}
      {errorVisita && <p role="alert" className="rounded bg-red-50 p-3 text-red-700">{errorVisita}</p>}
      {!ruta && !errorCarga && !errorVisitas && <p>Cargando…</p>}

      {ruta && grupos.length > 0 && !delChofer && (
        <p className="rounded bg-amber-50 p-3 text-sm text-amber-800">
          No se encontró un recorrido para tu nombre. Elige uno abajo.
        </p>
      )}

      {ruta && grupos.length > 1 && (
        <div role="group" aria-label="Recorrido" className="grid grid-cols-2 gap-2">
          {grupos.map((g) => (
            <button
              key={g.clave}
              type="button"
              aria-pressed={g === grupo}
              className={`min-h-14 rounded border-2 px-3 text-lg font-semibold ${g === grupo ? 'border-teal-700 bg-teal-700 text-white' : 'border-slate-300 bg-white'}`}
              onClick={() => setElegido(g.clave)}
            >
              {g.titulo}
            </button>
          ))}
        </div>
      )}

      {ruta && !grupo && (
        <p className="text-lg text-slate-700">{diaSemana(fecha) > 5 ? 'Sábado y domingo no hay ruta.' : 'No hay paradas para esta fecha.'}</p>
      )}
      {grupo && grupo.paradas.some((p) => p.entregar.length > 0) && (
        <ul className="flex flex-col gap-4" aria-label={grupo.titulo}>
          {grupo.paradas.filter((p) => p.entregar.length > 0).map(tarjeta)}
        </ul>
      )}
      {grupo && grupo.paradas.some((p) => p.entregar.length === 0) && (
        <Plegable
          key={grupo.clave}
          titulo={`Pasar a retirar (${grupo.paradas.filter((p) => p.entregar.length === 0).length})`}
          detalle="Clientes fijos de esta ruta (y visitas pedidas) sin nada que entregar: pasar por si hay retiro."
        >
          <ul className="flex flex-col gap-4">{grupo.paradas.filter((p) => p.entregar.length === 0).map(tarjeta)}</ul>
        </Plegable>
      )}
    </div>
  )
}
