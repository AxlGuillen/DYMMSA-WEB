import { driver } from 'driver.js'
import 'driver.js/dist/driver.css'

/**
 * Vistas guiadas (ADR-024): OVERVIEWS opcionales — nunca arrancan solas.
 * Anclas por data-tour, jamás clases: el estilo cambia, el ancla no.
 */
export interface OverviewStep {
  /** Selector del bloque (por convención `[data-tour="..."]`). */
  selector: string
  title: string
  description: string
  side?: 'top' | 'bottom' | 'left' | 'right'
}

/**
 * Primer match VISIBLE: el sidebar existe dos veces en el DOM y hay secciones
 * condicionales. checkVisibility no existe en jsdom → ahí basta existir.
 */
function resolveVisible(selector: string): Element | null {
  for (const el of document.querySelectorAll(selector)) {
    if (
      typeof el.checkVisibility !== 'function' ||
      el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
    ) {
      return el
    }
  }
  return null
}

/** Arranca solo con los bloques presentes — lo condicional se salta, sin popovers huérfanos. */
export function startOverview(steps: OverviewStep[]) {
  const present = steps.flatMap((step) => {
    const element = resolveVisible(step.selector)
    return element ? [{ step, element }] : []
  })
  if (present.length === 0) return

  driver({
    showProgress: true,
    progressText: '{{current}} de {{total}}',
    nextBtnText: 'Siguiente',
    prevBtnText: 'Anterior',
    doneBtnText: 'Listo',
    overlayOpacity: 0.6,
    stagePadding: 6,
    stageRadius: 8,
    popoverClass: 'dymmsa-tour',
    steps: present.map(({ step, element }) => ({
      element,
      popover: {
        title: step.title,
        description: step.description,
        side: step.side,
      },
    })),
  }).drive()
}
