import type { OverviewStep } from '@/lib/tours'

/** Overview de proveedores de menudeo (issue #74). */
export const SUPPLIERS_TOUR: OverviewStep[] = [
  {
    selector: '[data-tour="sup-filters"]',
    title: 'Encontrar al proveedor correcto',
    description:
      'Busca por nombre o filtra por <b>marca</b>: la pregunta típica es "¿quién me vende TRUPER?" — el filtro te da la respuesta directa.',
  },
  {
    selector: '[data-tour="sup-table"]',
    title: 'Contactos y sus marcas',
    description:
      'Cada proveedor con su teléfono, WhatsApp y las marcas que maneja. Es el directorio para la <b>compra local</b>: lo que el planificador de compra manda a menudeo se surte con esta gente.',
  },
  {
    selector: '[data-tour="sup-actions"]',
    title: 'Proveedores y catálogo de marcas',
    description:
      '<b>Marcas</b> administra el catálogo global (se normaliza a mayúsculas; una marca en uso no se puede borrar). <b>Agregar proveedor</b> da de alta el contacto y le asigna sus marcas.',
    side: 'bottom',
  },
]
