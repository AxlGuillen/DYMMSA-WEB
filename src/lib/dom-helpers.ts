/**
 * Hace scroll a la fila identificada por `data-row-id="<id>"` (centrada y suave).
 * Útil para llevar al usuario al ítem ofensor tras un error de validación.
 *
 * No-op en SSR o si el elemento no existe.
 */
export function scrollToRow(id: string): void {
  if (typeof document === 'undefined') return
  const el = document.querySelector(`[data-row-id="${CSS.escape(id)}"]`)
  if (el instanceof HTMLElement) {
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }
}

/**
 * Enfoca el input con el `id` dado (el focus lo trae a la vista y pone el
 * cursor). Útil para llevar al usuario al campo faltante tras un aviso de
 * validación. No-op en SSR o si el elemento no existe.
 */
export function focusById(id: string): void {
  if (typeof document === 'undefined') return
  const el = document.getElementById(id)
  if (el instanceof HTMLElement) el.focus()
}
