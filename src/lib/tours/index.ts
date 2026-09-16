import { driver } from 'driver.js'
import 'driver.js/dist/driver.css'

/**
 * Guided overviews (ADR-024): optional, they never auto-start.
 * Anchored on data-tour, never on classes: styles change, anchors don't.
 */
export interface OverviewStep {
  /** Block selector (by convention `[data-tour="..."]`). */
  selector: string
  title: string
  description: string
  side?: 'top' | 'bottom' | 'left' | 'right'
}

/** First VISIBLE match: the sidebar exists twice in the DOM. checkVisibility is absent in jsdom, so existing is enough there. */
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

/** Starts with the present blocks only — conditional ones are skipped, no orphan popovers. */
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
