import type { OverviewStep } from '@/lib/tours'

/**
 * Overview del detalle de cotización (issue #74). Varias secciones dependen
 * del estado (link solo en aprobación, ✓/✗ solo en approved): los pasos
 * ausentes se saltan solos — el tour se adapta a la etapa de la cotización.
 */
export const QUOTATION_DETAIL_TOUR: OverviewStep[] = [
  {
    selector: '[data-tour="qd-status"]',
    title: 'El estado manda',
    description:
      'La etapa de la cotización, y puedes moverla a mano. Ojo: <b>cada cambio de estado regenera el link de aprobación</b> — el que compartiste antes muere. Con cambios sin guardar el selector se bloquea.',
    side: 'bottom',
  },
  {
    selector: '[data-tour="qd-actions"]',
    title: 'Acciones según la etapa',
    description:
      'Los botones cambian con el estado: en borrador <b>Enviar a aprobación</b>; aprobada, <b>Generar orden</b> (descuenta stock al crearla); con piezas DYMMSA aparece <b>Planificar corte</b>. Eliminar siempre está al final.',
    side: 'bottom',
  },
  {
    selector: '[data-tour="qd-approval-link"]',
    title: 'El link para el cliente',
    description:
      'Cópialo y mándalo por WhatsApp o correo: el cliente aprueba producto por producto <b>sin necesidad de cuenta</b>. Puede guardar avance y retomar después; al enviar su decisión, el estado cambia solo y te llega un correo.',
  },
  {
    selector: '[data-tour="qd-stats"]',
    title: 'El pulso de la cotización',
    description:
      'Totales y conteos. Durante la aprobación, las tarjetas <b>Aprobados / Rechazados / Pendientes</b> también filtran la tabla al hacer clic. El total se calcula en vivo de los productos (separadores y "no lo vendemos" fuera).',
  },
  {
    selector: '[data-tour="qd-items"]',
    title: 'Los productos',
    description:
      'La tabla completa, editable mientras la cotización esté en borrador, en aprobación o aprobada. En estado <b>aprobada</b>, los ítems nuevos llegan como pendientes y aquí mismo los apruebas/rechazas con ✓/✗. Reordena arrastrando; los separadores agrupan con su color.',
  },
]
