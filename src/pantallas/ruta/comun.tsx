import { useCallback, useEffect, useRef, useState } from 'react'
import type { Repo } from '../../data/repo'
import { unidadesListasPorLinea } from '../../dominio/entrega'
import type { DatosOperacion } from '../../dominio/listo'
import { ErrorVisita, type Parada } from '../../dominio/ruta'
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

/** "Cuchillo 4, Tijera 1": unidades listas por producto de un trabajo. */
export function textoProductos(datos: DatosOperacion, trabajoId: string): string {
  return unidadesListasPorLinea(datos, trabajoId).map((l) => `${l.producto} ${l.listas}`).join(', ')
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

export const ESTADO_VISITA = { si: 'Confirmada', no: 'No confirmada', sin_respuesta: 'Sin respuesta' } as const
