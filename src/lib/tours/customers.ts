import type { OverviewStep } from '@/lib/tours'

/** Clientes list (#145): Odoo customers with what they owe in a due-date window. */
export const CUSTOMERS_LIST_TOUR: OverviewStep[] = [
  {
    selector: '[data-tour="cli-range"]',
    title: 'El rango manda',
    description:
      'Filtra por <b>fecha de vencimiento</b>: sin "desde" entra todo lo vencido, por viejo que sea. Elige si ver vencidas, por vencer o ambas. El rango viaja al abrir un cliente y <b>Todo lo vencido + este mes</b> lo regresa al inicio.',
    side: 'bottom',
  },
  {
    selector: '[data-tour="cli-refresh"]',
    title: 'Leído de Odoo',
    description:
      'Clientes y facturas se <b>leen de Odoo</b>, no se copian: se guardan 15 minutos para no saturarlo. Si acabas de registrar un pago allá, dale <b>Actualizar</b>.',
    side: 'bottom',
  },
  {
    selector: '[data-tour="cli-totals"]',
    title: 'La cartera de un vistazo',
    description:
      'Lo vencido, lo por vencer y el total por cobrar del rango. Las <b>notas de crédito</b> sin aplicar van aparte: son saldo a favor del cliente y no se restan.',
  },
  {
    selector: '[data-tour="cli-search"]',
    title: 'Encontrar un cliente',
    description: 'Busca por nombre o ciudad. <b>Solo con saldo</b> esconde a quien no debe nada en el rango ni tiene notas de crédito.',
    side: 'bottom',
  },
  {
    selector: '[data-tour="cli-table"]',
    title: 'Cliente por cliente',
    description:
      'Ordenados por lo que deben. Un monto vencido en <b>rojo</b> es para cobrar ya. <b>Días de cobro</b> es el promedio que calcula Odoo. Abre un cliente para su estado de cuenta.',
    side: 'top',
  },
]

/** Customer detail (#145): contact, statement to export and the latest Odoo activity. */
export const CUSTOMER_DETAIL_TOUR: OverviewStep[] = [
  {
    selector: '[data-tour="cli-range"]',
    title: 'El periodo del estado de cuenta',
    description:
      'El mismo filtro de la lista: lo que elijas aquí es lo que sale en el Excel y en la impresión.',
    side: 'bottom',
  },
  {
    selector: '[data-tour="cli-contact"]',
    title: 'Contacto',
    description:
      'Teléfono, correo y RFC tal como están en Odoo. Son de <b>uso interno</b>: ni el Excel ni la impresión los llevan.',
    side: 'bottom',
  },
  {
    selector: '[data-tour="cli-statement-totals"]',
    title: 'Lo que debe',
    description:
      'Vencido, por vencer y total del periodo, con cuántas facturas suma cada uno. Una factura en otra moneda se suma sin convertir y la tarjeta lo avisa.',
  },
  {
    selector: '[data-tour="cli-statement"]',
    title: 'Estado de cuenta',
    description:
      'Cada factura abierta con su vencimiento y su <b>saldo</b> (lo que falta tras pagos parciales). Vencer hoy cuenta como por vencer.',
    side: 'top',
  },
  {
    selector: '[data-tour="cli-export"]',
    title: 'Mandárselo al cliente',
    description:
      '<b>Excel</b> o <b>Imprimir</b> (también sirve para guardar PDF). Solo llevan nombre, folios, fechas y montos — nada de datos sensibles.',
    side: 'left',
  },
  {
    selector: '[data-tour="cli-credit-notes"]',
    title: 'Notas de crédito',
    description: 'Saldo a favor del cliente sin aplicar. Se muestra aparte y no se resta: no se sabe si la usará.',
  },
  {
    selector: '[data-tour="cli-activity"]',
    title: 'Movimiento reciente',
    description: 'Las últimas ventas y pagos del cliente en Odoo, para ver si viene comprando y pagando.',
    side: 'top',
  },
]
