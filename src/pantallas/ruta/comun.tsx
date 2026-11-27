import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import type { Repo } from '../../data/repo'
import { unidadesListasPorLinea } from '../../dominio/entrega'
import type { DatosOperacion } from '../../dominio/listo'
import { ErrorVisita, type Confirmacion, type Parada } from '../../dominio/ruta'
import type { Modalidad, Recorrido, Visita } from '../../dominio/tipos'

export const NOMBRES_SALIDA: Record<Modalidad, string> = {
  ruta_propia: 'Ruta propia',
  cliente: 'Retira en mostrador',
  encomienda: 'Encomienda',
}

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

/** "miércoles 25 de noviembre" para una fecha 'YYYY-MM-DD' (sin depender de la zona del navegador). */
export function fechaLarga(fecha: string): string {
  const [a, m, d] = fecha.split('-').map(Number)
  return `${DIAS[new Date(Date.UTC(a, m - 1, d)).getUTCDay()]} ${d} de ${MESES[m - 1]}`
}

/** "Cuchillo 4, Cuaderno (Ø14 blanco) 1": unidades listas por producto (con su detalle) de un trabajo. */
export function textoProductos(datos: DatosOperacion, trabajoId: string): string {
  return unidadesListasPorLinea(datos, trabajoId)
    .map((l) => `${l.producto}${l.nota ? ` (${l.nota})` : ''} ${l.listas}`)
    .join(', ')
}

export const ERROR_VISITAS = 'No se pudieron cargar las visitas. Revisa tu conexión.'

/** Visitas de un día. No están en Realtime: `recargar` se llama después de las escrituras de la pantalla. */
export function useVisitas(repo: Repo, fecha: string) {
  const [estado, setEstado] = useState<{ fecha: string; visitas: Visita[]; error: string } | null>(null)
  const pedido = useRef(0)
  const recargar = useCallback(async () => {
    const mio = ++pedido.current
    try {
      const visitas = await repo.listarVisitas(fecha)
      if (mio === pedido.current) setEstado({ fecha, visitas, error: '' })
    } catch (e) {
      if (mio === pedido.current) setEstado({ fecha, visitas: [], error: e instanceof ErrorVisita ? e.message : ERROR_VISITAS })
    }
  }, [repo, fecha])
  useEffect(() => {
    void recargar()
    return () => {
      pedido.current++ // ignora respuestas tardías (otra fecha, o la pantalla ya se cerró)
    }
  }, [recargar])
  const actual = estado && estado.fecha === fecha ? estado : null
  return { visitas: actual?.visitas ?? null, error: actual?.error ?? '', recargar }
}

export const GRUPO_EXTRA = '__extra__'

export interface GrupoParadas {
  clave: string
  titulo: string
  paradas: Parada[]
}

/** Paradas agrupadas por recorrido (en el orden de armarRuta); las visitas fuera de recorrido van en "Visitas extra". */
export function agruparParadas(paradas: Parada[], recorridos: Recorrido[]): GrupoParadas[] {
  const m = new Map<string, GrupoParadas>()
  for (const p of paradas) {
    const clave = p.recorridoId ?? GRUPO_EXTRA
    let g = m.get(clave)
    if (!g) {
      const camioneta = recorridos.find((r) => r.id === p.recorridoId)?.camioneta
      g = { clave, titulo: p.recorridoId ? `${p.recorridoNombre}${camioneta ? ` · ${camioneta}` : ''}` : 'Visitas extra', paradas: [] }
      m.set(clave, g)
    }
    g.paradas.push(p)
  }
  return [...m.values()]
}

/**
 * "Fijo" o "A pedido" junto al nombre del cliente en una parada de recorrido (las visitas extra ya
 * dicen "Visita extra"). A pedido = no se pasa siempre: hoy sale porque tiene algo o lo pidió.
 */
export function InsigniaParada({ parada }: { parada: Parada }) {
  if (parada.recorridoId === null) return null
  return (
    <span
      className={`ml-1 inline-block rounded px-2 py-0.5 align-middle text-sm font-semibold ${
        parada.fija ? 'bg-slate-200 text-slate-800' : 'bg-amber-100 text-amber-900'
      }`}
    >
      {parada.fija ? 'Fijo' : 'A pedido'}
    </span>
  )
}

export const ESTADO_VISITA = { si: 'Confirmada', no: 'No confirmada', sin_respuesta: 'Sin respuesta' } as const

const OPCIONES_VISITA: { id: Confirmacion; titulo: string }[] = [
  { id: 'si', titulo: 'Sí' },
  { id: 'no', titulo: 'No' },
  { id: 'sin_respuesta', titulo: 'Sin respuesta' },
]

/** Sí / No / Sin respuesta de la visita de una parada (botones grandes; un radio nativo por opción). */
export function ControlVisita({ parada, ocupado, alMarcar }: { parada: Parada; ocupado: boolean; alMarcar: (c: Confirmacion) => void }) {
  return (
    <div role="radiogroup" aria-label={`Visita ${parada.clienteNombre}`} className="grid grid-cols-3 gap-2 print:hidden">
      {OPCIONES_VISITA.map((c) => (
        <label
          key={c.id}
          className={`flex min-h-14 cursor-pointer items-center justify-center rounded border-2 px-2 text-center text-lg focus-within:ring-4 focus-within:ring-teal-300 ${
            parada.confirmada === c.id ? 'border-teal-700 bg-teal-700 text-white' : 'border-slate-300 bg-white'
          }`}
        >
          <input
            type="radio"
            className="sr-only"
            name={`visita-${parada.clienteId}`}
            checked={parada.confirmada === c.id}
            disabled={ocupado}
            onChange={() => alMarcar(c.id)}
          />
          {c.titulo}
        </label>
      ))}
    </div>
  )
}

/**
 * Sección que se puede plegar (cerrada por defecto) pero que al imprimir siempre sale completa:
 * el contenido se queda en la página, oculto en pantalla con `hidden` y visible en papel.
 */
export function Plegable({ titulo, detalle, children }: { titulo: string; detalle?: string; children: ReactNode }) {
  const [abierta, setAbierta] = useState(false)
  const id = useId()
  return (
    <section aria-labelledby={`${id}-t`} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={`${id}-t`} className="text-xl font-bold">{titulo}</h2>
        <button
          type="button"
          aria-expanded={abierta}
          aria-controls={`${id}-c`}
          className="min-h-12 rounded border-2 border-slate-300 bg-white px-4 text-lg font-semibold print:hidden"
          onClick={() => setAbierta((a) => !a)}
        >
          {abierta ? 'Ocultar' : 'Mostrar'}
        </button>
      </div>
      {detalle && <p className="text-slate-700">{detalle}</p>}
      <div
        id={`${id}-c`}
        aria-hidden={!abierta}
        className={`${abierta ? 'flex' : 'hidden'} flex-col gap-3 print:flex`}
      >
        {children}
      </div>
    </section>
  )
}
