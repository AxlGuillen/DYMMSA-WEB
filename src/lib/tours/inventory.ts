import type { OverviewStep } from '@/lib/tours'

/** Overview del inventario de tienda (issue #74). */
export const INVENTORY_TOUR: OverviewStep[] = [
  {
    selector: '[data-tour="inv-stats"]',
    title: 'Semáforo de stock',
    description:
      'La salud del inventario: <b>con stock</b> (más de 5), <b>stock bajo</b> (1 a 5) y <b>sin stock</b>. Cada tarjeta filtra la tabla al hacer clic. El stock baja solo al crear órdenes y sube con la recepción de excedentes.',
  },
  {
    selector: '[data-tour="inv-filters"]',
    title: 'Buscar y filtrar por marca',
    description:
      'Busca por código modelo. El selector de marcas muestra <b>cuántos tienen stock de cada una</b> (con stock/total) para no filtrar a ciegas.',
  },
  {
    selector: '[data-tour="inv-table"]',
    title: 'El stock y sus gavetas',
    description:
      'Cantidad y <b>ubicación física</b> (gaveta) por producto. La ubicación se conserva aunque el stock llegue a cero — solo se oculta para no mandar a buscar a una gaveta vacía. Edita cualquier fila con el lápiz.',
  },
  {
    selector: '[data-tour="inv-actions"]',
    title: 'Importar y agregar',
    description:
      'El <b>import por Excel</b> acepta columnas de código, cantidad y ubicación; en modo actualizar no pisa la gaveta si el archivo no la trae. También puedes dar de alta un producto a mano.',
    side: 'bottom',
  },
]
