import { useCallback, useEffect, useRef, useState } from 'react'
import { diaLocal, msHastaCambioDeDia } from '../dominio/fechas'

const hoySantiago = () => diaLocal(new Date().toISOString())

/**
 * Fecha de una pantalla ('YYYY-MM-DD') con un valor por defecto que depende de hoy en Santiago
 * (`calcular(hoy)`). Mientras el usuario no elija otra fecha, el valor por defecto se recalcula al
 * volver a la pantalla (la app quedó abierta de un día para otro) y cuando cambia el día con la
 * pantalla abierta. Si el usuario eligió una fecha, se respeta.
 * Devuelve [fecha, elegir]; `elegir` marca la fecha como elegida a mano.
 */
export function useFechaPorDefecto(calcular: (hoy: string) => string): [string, (fecha: string) => void] {
  const calcularRef = useRef(calcular)
  calcularRef.current = calcular
  const manual = useRef(false)
  const [fecha, setFecha] = useState(() => calcular(hoySantiago()))

  useEffect(() => {
    let reloj: ReturnType<typeof setTimeout> | undefined
    const refrescar = () => {
      if (!manual.current) setFecha(calcularRef.current(hoySantiago()))
    }
    const programar = () => {
      clearTimeout(reloj)
      // Un segundo de margen: el temporizador puede adelantarse un poco respecto del reloj del sistema.
      reloj = setTimeout(() => {
        refrescar()
        programar()
      }, msHastaCambioDeDia(new Date()) + 1000)
    }
    const alVolver = () => {
      if (document.visibilityState !== 'visible') return
      refrescar()
      programar() // en segundo plano los temporizadores se atrasan: se reprograma desde ahora
    }
    programar()
    document.addEventListener('visibilitychange', alVolver)
    return () => {
      clearTimeout(reloj)
      document.removeEventListener('visibilitychange', alVolver)
    }
  }, [])

  const elegir = useCallback((f: string) => {
    manual.current = true
    setFecha(f)
  }, [])
  return [fecha, elegir]
}
