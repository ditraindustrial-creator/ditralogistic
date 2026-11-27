import { useMemo, useState } from 'react'
import type { Repo } from '../../data/repo'
import { diaLocal } from '../../dominio/fechas'
import { resumenListo, type FilaListo } from '../../dominio/listo'
import { fechaHoraSantiago, resumenPlan } from '../../dominio/planificacion'
import type { Area } from '../../dominio/tipos'
import { useDatosEnVivo } from '../useDatosEnVivo'
import { useFechaPorDefecto } from '../useFechaPorDefecto'
import { COLOR_AREA } from '../colorArea'

const elMismoDia = (hoy: string) => hoy

const DIAS: Record<number, string> = { 1: 'Lunes', 2: 'Martes', 3: 'Miércoles', 4: 'Jueves', 5: 'Viernes' }
const DIAS_CORTOS: Record<number, string> = { 1: 'Lun', 2: 'Mar', 3: 'Mié', 4: 'Jue', 5: 'Vie' }
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
  /** Fecha de la próxima ruta ('YYYY-MM-DD'); "~" deja "Sin recorrido" al final. */
  fecha: string
  filas: FilaListo[]
}

/** "Mié 26/11", y "(hoy)" si es hoy. */
function etiquetaFecha(fecha: string, dia: number, hoy: string): string {
  const [, m, d] = fecha.split('-').map(Number)
  return `${DIAS_CORTOS[dia] ?? ''} ${d}/${m}${fecha === hoy ? ' (hoy)' : ''}`
}

/** "Rutas: Lun · Mié · Vie" (días distintos, de lunes a viernes). */
function textoRutas(f: FilaListo): string {
  return `Rutas: ${[...new Set(f.rutas.map((r) => r.dia))].map((d) => DIAS_CORTOS[d]).join(' · ')}`
}

/** Agrupa por la próxima ruta del cliente (recorrido + fecha); los que no tienen recorrido, aparte. */
function agrupar(filas: FilaListo[], hoy: string): Grupo[] {
  const grupos = new Map<string, Grupo>()
  for (const f of filas) {
    const p = f.proximaRuta
    const clave = p ? `${p.fecha}|${p.recorridoId}` : SIN_RECORRIDO
    let g = grupos.get(clave)
    if (!g) {
      g = p
        ? { clave, titulo: `${p.recorridoNombre} · ${etiquetaFecha(p.fecha, p.dia, hoy)}`, fecha: p.fecha, filas: [] }
        : { clave, titulo: 'Sin recorrido', fecha: '~', filas: [] }
      grupos.set(clave, g)
    }
    g.filas.push(f)
  }
  const cuando = (f: FilaListo) => (f.listoDesde ? Date.parse(f.listoDesde) : Infinity)
  for (const g of grupos.values()) {
    g.filas.sort((a, b) => cuando(a) - cuando(b) || a.clienteNombre.localeCompare(b.clienteNombre, 'es') || a.numero - b.numero)
  }
  return [...grupos.values()].sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0) || a.titulo.localeCompare(b.titulo, 'es'))
}

export default function Listo({ repo }: { repo: Repo }) {
  const { datos, error, conectado } = useDatosEnVivo(repo)
  // Hoy en Chile (se renueva al cambiar el día con la pantalla abierta): la próxima ruta se cuenta desde hoy, hoy incluido.
  const [hoy] = useFechaPorDefecto(elMismoDia)
  const filas = useMemo(() => (datos ? resumenListo(datos, hoy) : null), [datos, hoy])
  const ahora = fechaHoraSantiago(new Date().toISOString())
  const [area, setArea] = useState('')
  const [cliente, setCliente] = useState('')
  const [recorrido, setRecorrido] = useState('')
  const [dia, setDia] = useState('')
  const [soloListas, setSoloListas] = useState(false)

  const clientes = useMemo(() => {
    const m = new Map<string, string>()
    for (const f of filas ?? []) m.set(f.clienteId, f.clienteNombre)
    return [...m].sort((a, b) => a[1].localeCompare(b[1], 'es'))
  }, [filas])
  const recorridos = useMemo(() => {
    const m = new Map<string, string>()
    for (const f of filas ?? []) for (const r of f.rutas) m.set(r.recorridoId, r.recorridoNombre)
    return [...m].sort((a, b) => a[1].localeCompare(b[1], 'es'))
  }, [filas])

  const visibles = (filas ?? []).filter(
    (f) =>
      (!area || f.area === area) &&
      (!cliente || f.clienteId === cliente) &&
      (!recorrido || (recorrido === SIN_RECORRIDO ? f.rutas.length === 0 : f.rutas.some((r) => r.recorridoId === recorrido))) &&
      (!dia || f.rutas.some((r) => r.dia === Number(dia))) &&
      (!soloListas || f.listas > 0),
  )
  const grupos = agrupar(visibles, hoy)

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
            {recorridos.map(([id, nombre]) => (
              <option key={id} value={id}>{nombre}</option>
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
                <li key={f.trabajoId} className={`rounded border-l-8 p-3 shadow-sm ${COLOR_AREA[f.area].borde} ${COLOR_AREA[f.area].fondo}`}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-lg font-semibold">{f.clienteNombre}</span>
                    <span className="text-sm text-slate-600">Trabajo N.º {f.numero} · <span className={COLOR_AREA[f.area].etiqueta}>{AREAS[f.area]}</span></span>
                  </div>
                  <p className={`text-xl font-bold ${f.listas > 0 ? 'text-teal-800' : 'text-slate-600'}`}>
                    {f.listas} de {f.pendientes} listas
                  </p>
                  {f.rutas.length > 0 && <p className="text-sm text-slate-600">{textoRutas(f)}</p>}
                  {resumenPlan(f.plan, ahora) && (
                    <p className="font-semibold text-amber-800">Entrega planificada: {resumenPlan(f.plan, ahora)}</p>
                  )}
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
