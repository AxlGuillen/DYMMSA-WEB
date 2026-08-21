import type { OverviewStep } from '@/lib/tours'

/**
 * Overview de /approve/[token] — el lector es el CLIENTE: tono sin jerga.
 * Filtros y dock solo existen en revisión; ausentes, se saltan solos.
 */
export const APPROVAL_TOUR: OverviewStep[] = [
  {
    selector: '[data-tour="approval-summary"]',
    title: 'Resumen de tu cotización',
    description:
      'Quién la recibe, cuándo se emitió, cuántos productos incluye y el total cotizado. El total de tu aprobación se calcula solo con lo que apruebes.',
    side: 'bottom',
  },
  {
    selector: '[data-tour="approval-filters"]',
    title: 'Filtros para cotizaciones grandes',
    description:
      'Puedes ver solo una marca o un proyecto a la vez, y el botón <b>Aprobar visibles</b> aprueba de un golpe lo que esté en pantalla bajo ese filtro.',
    side: 'bottom',
  },
  {
    selector: '[data-tour="approval-table"]',
    title: 'Los productos, uno por uno',
    description:
      'Cada fila trae descripción, precio, cantidad, subtotal y tiempo de entrega. Con el botón <b>Aprobar</b> marcas lo que sí quieres (se pinta de verde; vuelve a tocarlo para quitarlo). Lo marcado como "No disponible" es informativo: no se cobra ni se aprueba.',
    side: 'top',
  },
  {
    selector: '[data-tour="approval-dock"]',
    title: 'Tu avance y el envío',
    description:
      'Aquí ves cuántos llevas aprobados y el total. <b>Guardar avance</b> deja tu selección guardada para retomar después con este mismo enlace. <b>Enviar</b> finaliza tu revisión (te pedimos confirmación antes) — después de enviar, el enlace ya no permite cambios.',
    side: 'top',
  },
]
