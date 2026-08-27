import type { OverviewStep } from '@/lib/tours'

/** Overview del catálogo oficial URREA/multimarca (issue #74). */
export const URREA_CATALOG_TOUR: OverviewStep[] = [
  {
    selector: '[data-tour="uc-filters"]',
    title: 'El catálogo oficial',
    description:
      'Los productos oficiales por marca (URREA, SURTEK, FOY…). El mismo código puede existir en varias marcas, por eso todo cruce es por <b>código + marca</b>. Filtra por marca con su conteo.',
  },
  {
    selector: '[data-tour="uc-table"]',
    title: 'Descripción oficial y STD',
    description:
      'La <b>descripción oficial</b> es la de mayor jerarquía: gana sobre la curada del catálogo ETM en cotizaciones nuevas. El <b>STD</b> (piezas por paquete) es lo que usa el planificador de compra para la matemática mayoreo vs menudeo.',
  },
  {
    selector: '[data-tour="uc-actions"]',
    title: 'Importar y agregar',
    description:
      'El import por Excel (código, marca, descripción, STD) actualiza o reemplaza el catálogo. Si una descripción oficial está mal, se corrige REIMPORTANDO — nunca editando la curada. Las cotizaciones ya guardadas no cambian: su descripción es un snapshot.',
    side: 'bottom',
  },
]
