/** Junta llamadas seguidas en una sola, `ms` después de la última. `cancelar` descarta la pendiente. */
export function crearDebounce(fn: () => void, ms: number) {
  let timer: ReturnType<typeof setTimeout> | null = null
  return {
    llamar() {
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        fn()
      }, ms)
    },
    cancelar() {
      if (timer !== null) clearTimeout(timer)
      timer = null
    },
  }
}
