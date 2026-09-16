/** Debounced localStorage: writing ~1000 items per mutation stalls the thread. Flushes on
 *  pagehide/hidden; getItem serves what is pending (read-your-writes). */
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
        // Quota full or any storage failure: ignored, it must not take down the app.
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
      // Re-schedule remaining keys; only cancel the timer when nothing is left to write.
      if (pending.size > 0) schedule()
      else if (timer) {
        clearTimeout(timer)
        timer = null
      }
    },

    /** Exposed for tests and to force a pending write. */
    flush,
  }
}
