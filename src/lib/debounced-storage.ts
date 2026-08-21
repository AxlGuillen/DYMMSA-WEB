/**
 * localStorage con setItem debounced: escribir ~1000 ítems por mutación traba
 * el hilo. Flush en pagehide/hidden; getItem sirve lo pendiente (read-your-writes).
 */
export function createDebouncedStorage(
  backing: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined,
  delayMs = 500,
) {
  const pending = new Map<string, string>()
  let timer: ReturnType<typeof setTimeout> | null = null

  const flush = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    if (!backing) {
      pending.clear()
      return
    }
    for (const [key, value] of pending) {
      try {
        backing.setItem(key, value)
      } catch {
        // Cuota llena u otro fallo de storage: se ignora (mismo criterio que
        // el persist por defecto — no debe tumbar la app).
      }
    }
    pending.clear()
  }

  const schedule = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(flush, delayMs)
  }

  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush()
    })
  }

  return {
    getItem: (name: string): string | null =>
      pending.has(name) ? pending.get(name)! : backing?.getItem(name) ?? null,

    setItem: (name: string, value: string): void => {
      pending.set(name, value)
      schedule()
    },

    removeItem: (name: string): void => {
      pending.delete(name)
      backing?.removeItem(name)
      // Si aún quedan otras keys pendientes, re-agenda su flush; solo cancela el
      // timer cuando no queda nada por escribir. (El store usa una sola key hoy,
      // pero borrar una no debe dejar a las demás sin flush.)
      if (pending.size > 0) schedule()
      else if (timer) {
        clearTimeout(timer)
        timer = null
      }
    },

    /** Expuesto para tests y para forzar la escritura pendiente si hiciera falta. */
    flush,
  }
}
