import { useId, useMemo } from 'react'
import type { Repo } from '../../data/repo'
import { diaLocal } from '../../dominio/fechas'
import { etiquetaHora, reporteDiario, type FilaReporte } from '../../dominio/reporte'
import { useDatosEnVivo } from '../useDatosEnVivo'
import { useFechaPorDefecto } from '../useFechaPorDefecto'
import { fechaLarga } from '../ruta/comun'
import { COLOR_FASE, type Fase } from '../colorEtapa'
import { fechaHoraSantiago, planesPorTrabajo, resumenPlan, type PlanTrabajo } from '../../dominio/planificacion'

const campo = 'min-h-12 rounded border bg-white p-3 text-lg'
const botonClaro = 'min-h-14 rounded border-2 border-slate-300 bg-white px-4 py-3 text-lg font-semibold'

const unidades = (n: number) => `${n} ${n === 1 ? 'unidad' : 'unidades'}`
const total = (filas: FilaReporte[]) => filas.reduce((s, f) => s + f.cantidad, 0)

function Seccion({ titulo, vacio, filas, fecha, conDia, planes, fase }: {
  titulo: string; vacio: string; filas: FilaReporte[]; fecha: string; conDia: boolean; planes: Map<string, PlanTrabajo>; fase: Fase
}) {
  const color = COLOR_FASE[fase]
  const id = useId()
  const ahora = fechaHoraSantiago(new Date().toISOString())
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2 print:break-inside-avoid">
      <div className={`flex items-baseline justify-between gap-2 border-b-4 pb-1 ${color.borde}`}>
        <h2 id={id} className={`text-xl font-bold ${color.texto} print:text-black`}>{titulo}</h2>
        <span className="text-slate-700">{filas.length === 0 ? 'Sin filas' : `${unidades(total(filas))} · ${filas.length} ${filas.length === 1 ? 'fila' : 'filas'}`}</span>
      </div>
      {filas.length === 0 ? (
        <p className="text-slate-600">{vacio}</p>
      ) : (
        <ul className="flex flex-col gap-2 print:gap-0">
          {filas.map((f, i) => (
            <li key={`${f.trabajoNumero}-${f.producto}-${i}`} className={`flex items-start justify-between gap-3 rounded border-l-8 ${color.borde} bg-white p-3 shadow-sm print:rounded-none print:border-l-0 print:border-b print:shadow-none`}>
              <div>
                <p className="text-lg font-semibold">
                  <span>{f.clienteNombre}</span>
                  {f.urgente && <span className="ml-2 rounded bg-red-100 px-2 text-sm font-bold text-red-800">Urgente</span>}
                </p>
                <p className="text-slate-700">
                  <span>Trabajo N.º {f.trabajoNumero}</span> · <span>{f.producto}{f.nota ? ` (${f.nota})` : ''}</span> · <span className="font-semibold">{unidades(f.cantidad)}</span>
                </p>
                {resumenPlan(planes.get(f.trabajoId), ahora) && (
                  <p className="font-semibold text-amber-800 print:text-black">Entrega planificada: {resumenPlan(planes.get(f.trabajoId), ahora)}</p>
                )}
              </div>
              <span className={`whitespace-nowrap text-lg font-bold ${color.texto} print:text-black`}>{conDia ? etiquetaHora(f.dia, fecha, f.hora) : f.hora}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

const elMismoDia = (hoy: string) => hoy

export default function Reporte({ repo }: { repo: Repo }) {
  const { datos, error, conectado } = useDatosEnVivo(repo)
  // Hoy en Santiago; se recalcula si la pantalla queda abierta de un día para otro (salvo fecha elegida).
  const [fecha, elegirFecha] = useFechaPorDefecto(elMismoDia)
  const hoy = diaLocal(new Date().toISOString())
  const reporte = useMemo(() => (datos ? reporteDiario(fecha, datos) : null), [datos, fecha])
  const planes = useMemo(() => (datos ? planesPorTrabajo(datos.trabajos, datos.entregasParciales) : new Map<string, PlanTrabajo>()), [datos])
  const esHoy = fecha === hoy

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <label className="flex flex-col gap-1">
          Fecha
          <input
            type="date"
            className={campo}
            value={fecha}
            onChange={(e) => e.target.value && elegirFecha(e.target.value)}
          />
        </label>
        <button type="button" className={botonClaro} onClick={() => window.print()}>Imprimir</button>
      </div>
      <p className="text-lg text-slate-700">{fechaLarga(fecha)}</p>

      {!conectado && <p role="status" className="text-sm text-amber-700 print:hidden">Reconectando…</p>}
      {error && <p role="alert" className="rounded bg-red-50 p-3 text-red-700 print:hidden">{error}</p>}
      {reporte === null && !error && <p>Cargando…</p>}
      {reporte && (
        <>
          {reporte.sinClasificar > 0 && (
            <p role="status" className="rounded bg-amber-50 p-3 text-amber-900">
              {reporte.sinClasificar} {reporte.sinClasificar === 1 ? 'línea sin clasificar' : 'líneas sin clasificar'}: tiene movimientos en etapas que no existen y no aparece en el reporte. Avisa al administrador.
            </p>
          )}
          <Seccion titulo={esHoy ? 'Listo hoy' : 'Listo ese día'} vacio="Nadie quedó listo ese día." filas={reporte.listo} fecha={fecha} conDia={false} planes={planes} fase="listo" />
          <Seccion titulo="En producción" vacio="No hay trabajos en producción." filas={reporte.enProduccion} fecha={fecha} conDia planes={planes} fase="taller" />
          <Seccion titulo="Por entregar" vacio="No hay nada pendiente de entrega." filas={reporte.porEntregar} fecha={fecha} conDia planes={planes} fase="listo" />
          <Seccion titulo="Recién recibido" vacio="No hay trabajos recién recibidos sin empezar." filas={reporte.recibido} fecha={fecha} conDia planes={planes} fase="recibido" />
        </>
      )}
    </div>
  )
}
