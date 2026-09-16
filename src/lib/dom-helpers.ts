/** Smooth-scroll to the `data-row-id` row; no-op in SSR. */
export function scrollToRow(id: string): void {
  if (typeof document === 'undefined') return
  const el = document.querySelector(`[data-row-id="${CSS.escape(id)}"]`)
  if (el instanceof HTMLElement) {
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }
}

/** Focus an input by id; no-op in SSR. */
export function focusById(id: string): void {
  if (typeof document === 'undefined') return
  const el = document.getElementById(id)
  if (el instanceof HTMLElement) el.focus()
}
