import type { OverviewStep } from '@/lib/tours'

/** Quotations list overview (#74): the sales-flow board. */
export const QUOTATIONS_LIST_TOUR: OverviewStep[] = [
  {
    selector: '[data-tour="ql-stats"]',
    title: 'El flujo en números',
    description:
      'Cuántas cotizaciones hay en cada etapa: borrador → en aprobación → aprobada/rechazada → convertida a orden. Cada tarjeta es también un <b>filtro</b>: haz clic para ver solo esa etapa (y clic otra vez para quitarlo).',
  },
  {
    selector: '[data-tour="ql-filters"]',
    title: 'Buscar y acotar',
    description:
      'Busca por cliente o por nombre de la cotización, filtra por estado con el selector, y elige qué columnas ver con el botón <b>Columnas</b> — tu selección se recuerda.',
  },
  {
    selector: '[data-tour="ql-table"]',
    title: 'Las cotizaciones',
    description:
      'Cada fila abre su detalle. El total es el de la última vez que se guardó: suma los productos con precio y cantidad, <b>aprobados o no</b> (sin separadores ni "no lo vendemos"); a la orden solo pasan los aprobados.',
  },
  {
    selector: '[data-tour="ql-new"]',
    title: 'Nueva cotización',
    description: 'Te lleva al cotizador: subir el Excel del cliente y armar la cotización.',
    side: 'bottom',
  },
]
