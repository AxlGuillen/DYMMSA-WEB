/** Scroll suave a la fila data-row-id (ítem ofensor tras validación); no-op en SSR. */
export function scrollToRow(id: string): void {
  if (typeof document === 'undefined') return
  const el = document.querySelector(`[data-row-id="${CSS.escape(id)}"]`)
  if (el instanceof HTMLElement) {
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }
}

/** Enfoca el input por id (campo faltante tras validación); no-op en SSR. */
export function focusById(id: string): void {
  if (typeof document === 'undefined') return
  const el = document.getElementById(id)
  if (el instanceof HTMLElement) el.focus()
}
