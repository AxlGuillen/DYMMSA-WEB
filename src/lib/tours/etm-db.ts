import type { OverviewStep } from '@/lib/tours'

/** Overview del catálogo ETM / base de datos (issue #74). */
export const ETM_DB_TOUR: OverviewStep[] = [
  {
    selector: '[data-tour="db-filters"]',
    title: 'El catálogo que aprende',
    description:
      'Todos los productos ETM que el sistema conoce. <b>Se alimenta solo</b>: cada cotización guardada enseña precios, marcas y descripciones (auto-learn). Busca por ETM, código modelo o descripción.',
  },
  {
    selector: '[data-tour="db-table"]',
    title: 'Los datos que pre-llenan el cotizador',
    description:
      'Precio, marca, <b>¿lo vendemos?</b> (sí / no / sin definir — solo el "no" excluye de totales y órdenes) y la <b>Descripción DYMMSA</b>. Ojo con la jerarquía: si el código existe en el catálogo URREA oficial, ESA descripción gana y la curada de aquí no se usa.',
  },
  {
    selector: '[data-tour="db-actions"]',
    title: 'Importar y agregar',
    description:
      'Carga masiva por Excel o alta manual. Normalmente no hace falta: el catálogo crece solo con el uso del cotizador.',
    side: 'bottom',
  },
]
