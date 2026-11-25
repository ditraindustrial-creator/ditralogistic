import { useCallback, useEffect, useRef, useState } from 'react'
import type { Repo } from '../data/repo'
import type { DatosOperacion } from '../dominio/listo'
import { crearDebounce } from './listo/debounce'

const ESPERA_RECARGA_MS = 400
const ERROR_CARGA = 'No se pudo cargar la información. Revisa tu conexión.'

export interface DatosEnVivo {
  /** null mientras no llega la primera carga. */
  datos: DatosOperacion | null
  /** Mensaje en español si la última carga falló; vacío si no. */
  error: string
  /** false mientras el canal en vivo está caído ("Reconectando…"). */
  conectado: boolean
  /** Recarga ya, sin esperar el aviso en vivo. */
  recargar: () => Promise<void>
}

/**
 * Carga `repo.cargarTodo()` y la mantiene al día: primero se suscribe y luego carga (para no perder
 * cambios entre ambas), junta las ráfagas de avisos en una recarga (400 ms) y recarga al volver a
 * la pestaña. Al desmontar cancela todo.
 */
export function useDatosEnVivo(repo: Repo): DatosEnVivo {
  const [datos, setDatos] = useState<DatosOperacion | null>(null)
  const [error, setError] = useState('')
  const [conectado, setConectado] = useState(true)
  const cargarRef = useRef<() => Promise<void>>(async () => undefined)
  const recargar = useCallback(() => cargarRef.current(), [])

  useEffect(() => {
    let activo = true
    let pedido = 0
    async function cargar() {
      const mio = ++pedido
      try {
        const d = await repo.cargarTodo()
        if (!activo || mio !== pedido) return // se desmontó, o llegó una carga más nueva
        setDatos(d)
        setError('')
      } catch {
        if (!activo || mio !== pedido) return
        setError(ERROR_CARGA)
      }
    }
    cargarRef.current = cargar
    // Los eventos llegan en ráfagas (un movimiento por línea): se juntan en una sola recarga.
    const recarga = crearDebounce(() => void cargar(), ESPERA_RECARGA_MS)
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

  return { datos, error, conectado, recargar }
}
