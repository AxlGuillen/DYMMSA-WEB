import { driver } from 'driver.js'
import 'driver.js/dist/driver.css'

/**
 * Vistas guiadas (issue #52, ADR-024) — driver.js con propósito de OVERVIEW:
 * explican qué es cada bloque de la pantalla y cómo se conecta con el resto,
 * no un paso-a-paso de captura. Cada módulo define sus pasos apuntando a
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
 * Arranca la vista guiada con los bloques que SÍ están en pantalla: las
 * secciones condicionales (candidatos ya consumidos, diagramas sin capturar)
 * simplemente se saltan en vez de mostrar un popover huérfano al centro.
 */
export function startOverview(steps: OverviewStep[]) {
  const present = steps.filter((step) => document.querySelector(step.selector))
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
    steps: present.map((step) => ({
      element: step.selector,
      popover: {
        title: step.title,
        description: step.description,
        side: step.side,
      },
    })),
  }).drive()
}
