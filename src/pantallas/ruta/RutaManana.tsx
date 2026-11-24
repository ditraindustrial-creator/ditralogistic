import { useMemo, useRef, useState } from 'react'
import type { Repo } from '../../data/repo'
import { diaLocal, diaSemana, siguienteDiaHabil } from '../../dominio/fechas'
import { lineasEntregables } from '../../dominio/entrega'
import { puedeEntregar } from '../../dominio/permisos'
import { resumenListo, type FilaListo } from '../../dominio/listo'
import { armarRuta, ErrorVisita, fechaValida, type Confirmacion, type Parada } from '../../dominio/ruta'
import { ErrorTrabajo, filtrarClientes } from '../../dominio/trabajo'
import type { Cliente, Modalidad, UsuarioActual } from '../../dominio/tipos'
import Entrega from '../entrega/Entrega'
import { useDatosEnVivo } from '../useDatosEnVivo'
import { agruparParadas, ESTADO_VISITA, fechaLarga, NOMBRES_SALIDA, textoProductos, useVisitas } from './comun'

const ERROR_VISITA = 'No se pudo guardar la visita. Revisa tu conexión e inténtalo de nuevo.'
const ERROR_SALIDA = 'No se pudo cambiar la salida. Revisa tu conexión e inténtalo de nuevo.'
const CONFIRMACIONES: { id: Confirmacion; titulo: string }[] = [
  { id: 'si', titulo: 'Sí' },
  { id: 'no', titulo: 'No' },
  { id: 'sin_respuesta', titulo: 'Sin respuesta' },
]
const AREAS = { afilado: 'Afilado', encuadernacion: 'Encuadernación' }

const campo = 'min-h-12 w-full rounded border bg-white p-3 text-lg'
const botonGrande = 'min-h-14 rounded bg-teal-700 px-5 py-3 text-xl font-semibold text-white disabled:opacity-50'
const botonClaro = 'min-h-14 rounded border-2 border-slate-300 bg-white px-4 py-3 text-lg font-semibold disabled:opacity-50'

const unidades = (n: number) => `${n} ${n === 1 ? 'trabajo' : 'trabajos'}`

export default function RutaManana({ repo, usuario }: { repo: Repo; usuario: UsuarioActual }) {
  const { datos, error: errorCarga, conectado, recargar } = useDatosEnVivo(repo)
  const [fecha, setFecha] = useState(() => siguienteDiaHabil(diaLocal(new Date().toISOString())))
  const { visitas, error: errorVisitas, recargar: recargarVisitas } = useVisitas(repo, fecha)
  const [aviso, setAviso] = useState('')
  const [error, setError] = useState('')
  const [entregando, setEntregando] = useState<{ trabajoId: string; titulo: string } | null>(null)
  const [extraAbierta, setExtraAbierta] = useState(false)
  const ocupado = useRef(new Set<string>())
  const [, repintar] = useState(0)

  const filas = useMemo(() => (datos ? resumenListo(datos) : null), [datos])
  const ruta = useMemo(
    () => (datos && filas && visitas ? armarRuta(fecha, filas, datos.clientes, datos.recorridos, visitas) : null),
    [datos, filas, visitas, fecha],
  )

  // Una acción a la vez por clave (cliente o trabajo): el guardián es síncrono para que un doble toque no duplique.
  async function hacer(clave: string, accion: () => Promise<void>, errorGenerico: string) {
    if (ocupado.current.has(clave)) return
    ocupado.current.add(clave)
    repintar((n) => n + 1)
    setError('')
    setAviso('')
    try {
      await accion()
    } catch (e) {
      // Solo se muestran tal cual los errores de regla (ya en español); lo demás es técnico.
      setError(e instanceof ErrorVisita || e instanceof ErrorTrabajo ? e.message : errorGenerico)
    } finally {
      ocupado.current.delete(clave)
      repintar((n) => n + 1)
    }
  }

  const marcar = (p: Parada, valor: Confirmacion) =>
    hacer(`visita-${p.clienteId}`, async () => {
      await repo.marcarVisita(fecha, p.clienteId, valor)
      await recargarVisitas()
    }, ERROR_VISITA)

  const cambiarSalida = (f: FilaListo, salida: Modalidad) =>
    hacer(`salida-${f.trabajoId}`, async () => {
      await repo.actualizarSalida(f.trabajoId, salida)
      await recargar() // los trabajos no están en Realtime: se recarga después de escribir
    }, ERROR_SALIDA)

  // Lo listo por ruta propia que no cae en ninguna lista de esta fecha (su recorrido sale otro día).
  const otroDia = useMemo(() => {
    if (!filas || !ruta) return 0
    const vistos = new Set([...ruta.paradas.flatMap((p) => p.entregar), ...ruta.sinRecorrido].map((f) => f.trabajoId))
    return filas.filter((f) => f.listas > 0 && f.salida === 'ruta_propia' && !vistos.has(f.trabajoId)).length
  }, [filas, ruta])

  const grupos = useMemo(() => agruparParadas(ruta?.paradas ?? [], datos?.recorridos ?? []), [ruta, datos])

  const finDeSemana = diaSemana(fecha) > 5

  return (
    <div className="flex flex-col gap-5">
      <div role="group" aria-label="Controles de la ruta" className="flex flex-col gap-3 print:hidden">
        <label className="flex flex-col gap-1 text-lg font-semibold">
          Fecha
          <input
            type="date"
            className={`${campo} font-normal`}
            value={fecha}
            onChange={(e) => {
              if (fechaValida(e.target.value)) {
                setFecha(e.target.value)
                setEntregando(null)
                setError('')
                setAviso('')
              }
            }}
          />
        </label>
        <button type="button" className={botonClaro} aria-expanded={extraAbierta} onClick={() => setExtraAbierta((a) => !a)}>
          Agregar visita extra
        </button>
      </div>
      <p className="text-xl font-bold">Ruta del {fechaLarga(fecha)}</p>

      {extraAbierta && datos && (
        <VisitaExtra
          clientes={datos.clientes}
          alAgregar={(c, nota) =>
            hacer('extra', async () => {
              await repo.agregarVisitaExtra(fecha, c.id, nota)
              await recargarVisitas()
              setAviso(`Visita agregada: ${c.nombre}`)
              setExtraAbierta(false)
            }, ERROR_VISITA)
          }
          ocupado={ocupado.current.has('extra')}
          error={error}
        />
      )}

      {entregando && datos && (
        <div className="print:hidden">
          <Entrega
            key={entregando.trabajoId}
            repo={repo}
            titulo={entregando.titulo}
            lineas={lineasEntregables(datos, [entregando.trabajoId])}
            alTerminar={() => void recargar()}
            alCerrar={() => setEntregando(null)}
          />
        </div>
      )}

      {aviso && <p role="status" className="rounded bg-teal-50 p-3 text-lg font-semibold text-teal-800">{aviso}</p>}
      {!extraAbierta && error && <p role="alert" className="rounded bg-red-50 p-3 text-red-700">{error}</p>}
      {!conectado && <p role="status" className="text-sm text-amber-700">Reconectando…</p>}
      {errorCarga && <p role="alert" className="rounded bg-red-50 p-3 text-red-700">{errorCarga}</p>}
      {errorVisitas && <p role="alert" className="rounded bg-red-50 p-3 text-red-700">{errorVisitas}</p>}
      {!ruta && !errorCarga && !errorVisitas && <p>Cargando…</p>}

      {ruta && (
        <>
          {finDeSemana && <p className="text-slate-700">Sábado y domingo no hay ruta.</p>}
          {!finDeSemana && grupos.length === 0 && <p className="text-slate-700">No hay paradas para esta fecha.</p>}
          {grupos.map((g) => (
            <section key={g.clave} aria-labelledby={`g-${g.clave}`} className="flex flex-col gap-2">
              <h2 id={`g-${g.clave}`} className="text-xl font-bold">{g.titulo}</h2>
              <ul className="flex flex-col gap-3">
                {g.paradas.map((p) => (
                  <li key={p.clienteId} className="flex flex-col gap-2 rounded border-l-8 border-teal-700 bg-white p-3 shadow-sm print:shadow-none">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-lg font-semibold">{p.clienteNombre}</span>
                      {(p.requiereConfirmacion || p.solicitada) && (
                        <span className="text-sm text-slate-700">
                          {p.solicitada ? 'Visita extra · ' : ''}{p.requiereConfirmacion ? `Visita: ${ESTADO_VISITA[p.confirmada]}` : ''}
                        </span>
                      )}
                    </div>
                    {p.nota && <p className="text-slate-700">Nota: {p.nota}</p>}
                    {p.entregar.length === 0 ? (
                      <p className="text-slate-600">Sin unidades listas para esta visita.</p>
                    ) : (
                      <ul className="flex flex-col gap-1">
                        {p.entregar.map((f) => (
                          <li key={f.trabajoId}>N.º {f.numero} · {datos ? textoProductos(datos, f.trabajoId) : ''}</li>
                        ))}
                      </ul>
                    )}
                    {p.requiereConfirmacion && (
                      <div role="radiogroup" aria-label={`Visita ${p.clienteNombre}`} className="grid grid-cols-3 gap-2 print:hidden">
                        {CONFIRMACIONES.map((c) => (
                          <label
                            key={c.id}
                            className={`flex min-h-14 cursor-pointer items-center justify-center rounded border-2 px-2 text-center text-lg ${
                              p.confirmada === c.id ? 'border-teal-700 bg-teal-700 text-white' : 'border-slate-300 bg-white'
                            }`}
                          >
                            <input
                              type="radio"
                              className="sr-only"
                              name={`visita-${p.clienteId}`}
                              checked={p.confirmada === c.id}
                              disabled={ocupado.current.has(`visita-${p.clienteId}`)}
                              onChange={() => void marcar(p, c.id)}
                            />
                            {c.titulo}
                          </label>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {otroDia > 0 && (
            <p className="text-slate-700">
              Hay {unidades(otroDia)} listo{otroDia === 1 ? '' : 's'} para otros días de ruta (no entra en esta fecha).
            </p>
          )}

          <FilasSueltas
            titulo="Sin recorrido"
            ayuda="Listo para la camioneta, pero el cliente no tiene recorrido. Asígnale uno en Administración o cambia la salida."
            filas={ruta.sinRecorrido}
            datos={datos}
            ocupado={(f) => ocupado.current.has(`salida-${f.trabajoId}`)}
            alCambiarSalida={cambiarSalida}
          />
          <FilasSueltas
            titulo="Retiran en mostrador"
            filas={ruta.retiranEnMostrador}
            datos={datos}
            ocupado={(f) => ocupado.current.has(`salida-${f.trabajoId}`)}
            alCambiarSalida={cambiarSalida}
            etiquetaEntregar="Entregar en mostrador"
            alEntregar={puedeEntregar(usuario.rol) ? (f) => {
              setAviso('')
              setEntregando({ trabajoId: f.trabajoId, titulo: 'Entregar en mostrador' })
            } : undefined}
          />
          <FilasSueltas
            titulo="Por encomienda"
            filas={ruta.porEncomienda}
            datos={datos}
            ocupado={(f) => ocupado.current.has(`salida-${f.trabajoId}`)}
            alCambiarSalida={cambiarSalida}
            etiquetaEntregar="Despachar"
            alEntregar={puedeEntregar(usuario.rol) ? (f) => {
              setAviso('')
              setEntregando({ trabajoId: f.trabajoId, titulo: 'Despachar por encomienda' })
            } : undefined}
          />
        </>
      )}
    </div>
  )
}

function FilasSueltas({
  titulo, ayuda, filas, datos, ocupado, alCambiarSalida, alEntregar, etiquetaEntregar,
}: {
  titulo: string
  ayuda?: string
  filas: FilaListo[]
  datos: ReturnType<typeof useDatosEnVivo>['datos']
  ocupado: (f: FilaListo) => boolean
  alCambiarSalida: (f: FilaListo, s: Modalidad) => void
  alEntregar?: (f: FilaListo) => void
  etiquetaEntregar?: string
}) {
  if (filas.length === 0) return null
  const id = `s-${titulo.replace(/\W+/g, '-')}`
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h2 id={id} className="text-xl font-bold">{titulo}</h2>
      {ayuda && <p className="text-sm text-slate-600 print:hidden">{ayuda}</p>}
      <ul className="flex flex-col gap-3">
        {filas.map((f) => (
          <li key={f.trabajoId} className="flex flex-col gap-2 rounded border-l-8 border-slate-300 bg-white p-3 shadow-sm print:shadow-none">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-lg font-semibold">{f.clienteNombre}</span>
              <span className="text-sm text-slate-700">N.º {f.numero} · {AREAS[f.area]}</span>
            </div>
            <p>{datos ? textoProductos(datos, f.trabajoId) : `${f.listas} listas`}</p>
            <div className="flex flex-wrap items-end gap-2 print:hidden">
              <label className="flex flex-1 flex-col gap-1 text-sm text-slate-700">
                Salida
                <select
                  aria-label={`Salida del trabajo N.º ${f.numero}`}
                  className={campo}
                  value={f.salida}
                  disabled={ocupado(f)}
                  onChange={(e) => alCambiarSalida(f, e.target.value as Modalidad)}
                >
                  {(Object.keys(NOMBRES_SALIDA) as Modalidad[]).map((m) => (
                    <option key={m} value={m}>{NOMBRES_SALIDA[m]}</option>
                  ))}
                </select>
              </label>
              {alEntregar && (
                <button type="button" className={botonGrande} onClick={() => alEntregar(f)}>
                  {etiquetaEntregar}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

function VisitaExtra({
  clientes, alAgregar, ocupado, error,
}: {
  clientes: Cliente[]
  alAgregar: (c: Cliente, nota: string) => void
  ocupado: boolean
  error: string
}) {
  const [cliente, setCliente] = useState<Cliente | null>(null)
  const [busqueda, setBusqueda] = useState('')
  const [nota, setNota] = useState('')
  const [aviso, setAviso] = useState('')
  const sugeridos = cliente ? [] : filtrarClientes(clientes, busqueda)

  return (
    <form
      className="flex flex-col gap-3 rounded border-2 border-teal-700 p-3 print:hidden"
      onSubmit={(e) => {
        e.preventDefault()
        if (!cliente) {
          setAviso('Elige el cliente de la visita.')
          return
        }
        setAviso('')
        alAgregar(cliente, nota)
      }}
    >
      {cliente ? (
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-sm text-slate-600">Cliente</p>
            <p className="text-lg font-semibold">{cliente.nombre}</p>
          </div>
          <button type="button" className={botonClaro} onClick={() => { setCliente(null); setBusqueda('') }}>Cambiar cliente</button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-lg font-semibold">
            Cliente
            <input type="search" autoComplete="off" placeholder="Nombre o RUT" className={`${campo} font-normal`} value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
          </label>
          {sugeridos.length > 0 && (
            <ul className="flex flex-col gap-1">
              {sugeridos.map((c) => (
                <li key={c.id}>
                  <button type="button" className="flex min-h-14 w-full flex-col rounded border bg-white p-3 text-left" onClick={() => { setCliente(c); setBusqueda('') }}>
                    <span className="text-lg font-semibold">{c.nombre}</span>
                    <span className="text-sm text-slate-600">{c.rut}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {busqueda.trim() !== '' && sugeridos.length === 0 && <p className="text-slate-600">No hay clientes con ese nombre o RUT.</p>}
        </div>
      )}
      <label className="flex flex-col gap-1 text-lg">
        Nota (opcional)
        <textarea className={campo} rows={2} value={nota} onChange={(e) => setNota(e.target.value)} />
      </label>
      {(aviso || error) && <p role="alert" className="rounded bg-red-50 p-3 text-red-700">{aviso || error}</p>}
      <button type="submit" className={botonGrande} disabled={ocupado}>Agregar</button>
    </form>
  )
}
