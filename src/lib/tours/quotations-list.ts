import type { OverviewStep } from '@/lib/tours'

/** Overview de la lista de cotizaciones (issue #74): el tablero del flujo de venta. */
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
      'Busca por cliente o por nombre de la cotización, filtra por estado con el selector, y elige qué columnas ver con el engrane — tu selección de columnas se recuerda.',
  },
  {
    selector: '[data-tour="ql-table"]',
    title: 'Las cotizaciones',
    description:
      'Cada fila abre su detalle. Ojo con el total: es el monto <b>sellado al guardar</b> — en cotizaciones aprobadas que se siguieron editando, el total vivo está en el detalle.',
  },
  {
    selector: '[data-tour="ql-new"]',
    title: 'Nueva cotización',
    description: 'Te lleva al cotizador: subir el Excel del cliente y armar la cotización.',
    side: 'bottom',
  },
]
