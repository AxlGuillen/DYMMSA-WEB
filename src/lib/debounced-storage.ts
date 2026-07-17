/**
 * localStorage con `setItem` debounced (trailing) para el draft del cotizador.
 *
 * Serializar y escribir ~1000 ítems en CADA mutación (agregar/editar/eliminar/
 * reordenar/renombrar sección) hace I/O síncrono que traba el hilo cuando se
 * encadenan acciones. Este wrapper coalesce las escrituras en una sola tras
 * `delayMs` de calma. Lecturas y `removeItem` son síncronos.
 *
 * Para no perder el último cambio si el usuario cierra/oculta la pestaña dentro
 * de la ventana de debounce, hace flush en `pagehide` y al pasar a `hidden`.
 * `getItem` sirve lo pendiente (read-your-writes) para que una recarga en
 * caliente no lea un valor viejo.
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
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      backing?.removeItem(name)
    },

    /** Expuesto para tests y para forzar la escritura pendiente si hiciera falta. */
    flush,
  }
}
