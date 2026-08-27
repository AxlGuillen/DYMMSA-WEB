import type { OverviewStep } from '@/lib/tours'

/** Overview del detalle de orden (#74); los bloques ausentes en cerradas se saltan solos. */
export const ORDER_DETAIL_TOUR: OverviewStep[] = [
  {
    selector: '[data-tour="od-status"]',
    title: 'La etapa de la orden',
    description:
      'Ordenada → Recibida → Entregada → Completada. Cancelar <b>devuelve al inventario</b> lo que la orden había descontado. Completada o cancelada, la orden queda de solo lectura.',
    side: 'bottom',
  },
  {
    selector: '[data-tour="od-actions"]',
    title: 'Las herramientas de la orden',
    description:
      '<b>Planificar compra</b> decide mayoreo vs menudeo y genera los Excel de pedido; <b>Planificar corte</b> (solo con piezas DYMMSA) arma el material a mandar hacer; el <b>Formato de Entrega</b> es el Excel para el cliente, e <b>Imprimir</b> saca la tabla en limpio.',
    side: 'bottom',
  },
  {
    selector: '[data-tour="od-stats"]',
    title: 'Cantidades de un vistazo',
    description:
      'Productos, cuánto salió de <b>stock</b> de la tienda, cuánto se <b>pidió</b> a URREA y el total. La regla siempre: en stock + a pedir = aprobado.',
  },
  {
    selector: '[data-tour="od-notes"]',
    title: 'Reglas de la pantalla',
    description: 'Recordatorios de dónde vive cada cosa — léelos una vez y este bloque deja de estorbar.',
  },
  {
    selector: '[data-tour="od-items"]',
    title: 'Los productos y la recepción',
    description:
      'Por producto: cantidades, la <b>gaveta</b> donde está su stock y el estado con URREA (pendiente → surtido / no surtido). Al confirmar la recepción, si llega <b>de más</b>, el excedente entra solo al inventario; recibir de menos deja el faltante visible. El excedente nunca se factura ni se entrega.',
  },
]
