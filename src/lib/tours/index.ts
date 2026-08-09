import { driver } from 'driver.js'
import 'driver.js/dist/driver.css'

/**
 * Vistas guiadas (issue #52, ADR-024) — driver.js con propósito de OVERVIEW:
 * explican qué es cada bloque de la pantalla y cómo se conecta con el resto,
 * no un paso-a-paso de captura. Siempre opcionales: se lanzan con el botón
 * "Vista guiada", nunca solas. Cada módulo define sus pasos apuntando a
 * atributos `data-tour="..."` (no a clases: el estilo cambia, el ancla no).
 */
export interface OverviewStep {
  /** Selector del bloque (por convención `[data-tour="..."]`). */
  selector: string
  title: string
  description: string
  side?: 'top' | 'bottom' | 'left' | 'right'
}

/**
 * El sidebar existe DOS veces en el DOM (drawer móvil + aside de desktop) y
 * varias secciones son condicionales: se resuelve el primer match VISIBLE.
 * Las opciones extienden el chequeo a `visibility` y `opacity` (por default
 * solo cubre display/content-visibility — review PR #62). `checkVisibility`
 * no existe en jsdom (tests) → ahí cuenta solo existir.
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

/**
 * Arranca la vista guiada con los bloques que SÍ están en pantalla: las
 * secciones condicionales (candidatos ya consumidos, filtros de una página
 * read-only) simplemente se saltan en vez de mostrar un popover huérfano.
 */
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
