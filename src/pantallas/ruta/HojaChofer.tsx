import { useMemo, useState } from 'react'
import type { Repo } from '../../data/repo'
import { lineasEntregables } from '../../dominio/entrega'
import { diaLocal, diaSemana } from '../../dominio/fechas'
import { resumenListo } from '../../dominio/listo'
import { armarRuta, fechaValida, type Parada } from '../../dominio/ruta'
import type { Cliente, UsuarioActual } from '../../dominio/tipos'
import Entrega from '../entrega/Entrega'
import FotoDocumento from '../entrega/FotoDocumento'
import Recepcion from '../recepcion/Recepcion'
import { useDatosEnVivo } from '../useDatosEnVivo'
import { agruparParadas, ESTADO_VISITA, fechaLarga, textoProductos, useVisitas } from './comun'

const campo = 'min-h-12 w-full rounded border bg-white p-3 text-lg'
const botonGrande = 'min-h-14 rounded bg-teal-700 px-5 py-3 text-xl font-semibold text-white disabled:opacity-50'
const botonClaro = 'min-h-14 rounded border-2 border-slate-300 bg-white px-5 py-3 text-xl font-semibold'

type Panel =
  | { tipo: 'entrega'; clienteNombre: string; trabajoIds: string[] }
  | { tipo: 'retiro'; cliente: Cliente; guardado: boolean }

export default function HojaChofer({ repo, usuario }: { repo: Repo; usuario: UsuarioActual }) {
  const { datos, error: errorCarga, conectado, recargar } = useDatosEnVivo(repo)
  const [fecha, setFecha] = useState(() => diaLocal(new Date().toISOString()))
  const { visitas, error: errorVisitas } = useVisitas(repo, fecha)
  const [elegido, setElegido] = useState('')
  const [panel, setPanel] = useState<Panel | null>(null)

  const ruta = useMemo(
    () => (datos && visitas ? armarRuta(fecha, resumenListo(datos), datos.clientes, datos.recorridos, visitas) : null),
    [datos, visitas, fecha],
  )
  const grupos = useMemo(() => agruparParadas(ruta?.paradas ?? [], datos?.recorridos ?? []), [ruta, datos])
  const grupo = grupos.find((g) => g.clave === elegido) ?? grupos[0]
  const trabajoPorId = useMemo(() => new Map((datos?.trabajos ?? []).map((t) => [t.id, t])), [datos])

  function tarjeta(p: Parada) {
    const cliente = datos?.clientes.find((c) => c.id === p.clienteId)
    return (
      <li key={p.clienteId} className="flex flex-col gap-3 rounded-lg border-l-8 border-teal-700 bg-white p-4 shadow">
        <h2 className="text-2xl font-bold">{p.clienteNombre}</h2>
        {(p.requiereConfirmacion || p.solicitada) && (
          <p className={`text-lg font-semibold ${p.requiereConfirmacion && p.confirmada === 'no' ? 'text-red-700' : 'text-slate-700'}`}>
            {p.solicitada ? 'Visita extra · ' : ''}{p.requiereConfirmacion ? `Visita: ${ESTADO_VISITA[p.confirmada]}` : ''}
          </p>
        )}
        {p.nota && <p className="text-slate-700">Nota: {p.nota}</p>}

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
                    {t?.guiaDespacho && (
                      <>
                        <span className="text-slate-700">Guía: {t.guiaDespacho}</span>
                        <FotoDocumento repo={repo} trabajoId={f.trabajoId} numero={f.numero} rutaActual={t.fotoDocumento} alCambiar={() => void recargar()} />
                      </>
                    )}
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
              setFecha(e.target.value)
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
      {!ruta && !errorCarga && !errorVisitas && <p>Cargando…</p>}

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
      {grupo && (
        <ul className="flex flex-col gap-4" aria-label={grupo.titulo}>
          {grupo.paradas.map(tarjeta)}
        </ul>
      )}
    </div>
  )
}
