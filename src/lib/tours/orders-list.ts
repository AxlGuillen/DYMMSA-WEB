import type { OverviewStep } from '@/lib/tours'

/** Overview de la lista de órdenes (issue #74): el tablero post-aprobación. */
export const ORDERS_LIST_TOUR: OverviewStep[] = [
  {
    selector: '[data-tour="ol-stats"]',
    title: 'Las órdenes por etapa',
    description:
      'El flujo después de la aprobación: <b>Ordenada → Recibida → Entregada → Completada</b> (o Cancelada). Cada tarjeta filtra la lista al hacer clic. Recuerda: el stock se descuenta al CREAR la orden; cancelarla o eliminarla lo devuelve.',
  },
  {
    selector: '[data-tour="ol-filters"]',
    title: 'Buscar y acotar',
    description: 'Busca por cliente o nombre de la orden, filtra por estado y elige columnas con el engrane.',
  },
  {
    selector: '[data-tour="ol-table"]',
    title: 'Las órdenes',
    description:
      'Cada fila abre su detalle: ahí viven las cantidades, la recepción de URREA, el formato de entrega y los accesos a Planificar compra y corte.',
  },
  {
    selector: '[data-tour="ol-new"]',
    title: 'Orden manual',
    description:
      'Para ventas que no pasaron por cotización: crea la orden directo. Lo normal es que las órdenes nazcan de una cotización aprobada con "Generar orden".',
    side: 'bottom',
  },
]
