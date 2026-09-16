/** UI sounds (ADR-017): the ONLY module importing cuelume, so dropping that young lib touches one file. */

import { play, setEnabled, type SoundName } from 'cuelume'

/** Controls that make a sound on click. */
const INTERACTIVE = 'button, a, [role="button"]'

/** Double-clicks and click bursts must not machine-gun. */
const THROTTLE_MS = 80

let lastPlay = 0
let initialized = false

function handleClick(event: MouseEvent): void {
  const target = event.target as Element | null
  const control = target?.closest?.(INTERACTIVE)
  if (!control) return
  // A disabled control does nothing, so it must not sound either.
  if (control instanceof HTMLButtonElement && control.disabled) return
  if (control.getAttribute('aria-disabled') === 'true') return

  const now = Date.now()
  if (now - lastPlay < THROTTLE_MS) return
  lastPlay = now

  playSound('press')
}

/** Idempotent (StrictMode mounts twice) and a no-op outside the browser. */
export function initSounds(enabled: boolean): void {
  if (typeof document === 'undefined' || initialized) return
  initialized = true
  setEnabled(enabled)
  document.addEventListener('click', handleClick)
}

/** cuelume ignores play() while off. */
export function setSoundEnabled(enabled: boolean): void {
  setEnabled(enabled)
}

/** Never throws: an audio failure must never break the UI. */
export function playSound(name: SoundName): void {
  try {
    play(name)
  } catch {
    // Web Audio blocked or unavailable: stay silent.
  }
}
