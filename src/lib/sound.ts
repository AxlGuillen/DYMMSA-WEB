/**
 * Sonidos de UI (ADR-017): ÚNICO módulo que importa cuelume (lib joven — si se
 * quita, se toca solo este archivo). Un listener delegado global; on/off en soundStore.
 */

import { play, setEnabled, type SoundName } from 'cuelume'

/** Selector de controles que suenan al click. */
const INTERACTIVE = 'button, a, [role="button"]'

/** Doble-click o clicks en ráfaga no deben metralletear. */
const THROTTLE_MS = 80

let lastPlay = 0
let initialized = false

function handleClick(event: MouseEvent): void {
  const target = event.target as Element | null
  const control = target?.closest?.(INTERACTIVE)
  if (!control) return
  // Un control deshabilitado no responde: tampoco debe sonar.
  if (control instanceof HTMLButtonElement && control.disabled) return
  if (control.getAttribute('aria-disabled') === 'true') return

  const now = Date.now()
  if (now - lastPlay < THROTTLE_MS) return
  lastPlay = now

  playSound('press')
}

/** Arranca los listeners; idempotente (StrictMode monta doble) y no-op fuera del navegador. */
export function initSounds(enabled: boolean): void {
  if (typeof document === 'undefined' || initialized) return
  initialized = true
  setEnabled(enabled)
  document.addEventListener('click', handleClick)
}

/** Enciende/apaga la reproducción (cuelume ignora los play() en off). */
export function setSoundEnabled(enabled: boolean): void {
  setEnabled(enabled)
}

/**
 * Toca un sonido puntual (feedback de acciones señaladas, p. ej. re-activar
 * el sonido). Nunca lanza: un fallo de audio jamás debe romper la UI.
 */
export function playSound(name: SoundName): void {
  try {
    play(name)
  } catch {
    // Web Audio bloqueado o no disponible: silencio, sin error.
  }
}
