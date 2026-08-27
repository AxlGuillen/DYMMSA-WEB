import type { OverviewStep } from '@/lib/tours'

/** Overview del cotizador (#74): cubre sus dos momentos; el ausente se salta solo. */
export const QUOTER_TOUR: OverviewStep[] = [
  {
    selector: '[data-tour="quoter-upload"]',
    title: 'Todo empieza con el Excel del cliente',
    description:
      'Arrastra o selecciona el archivo que mandó el cliente. El sistema lee los códigos ETM, los cruza con el catálogo y pre-llena la tabla con precio, marca y descripción de lo que ya conoce — solo completas lo que falte.',
  },
  {
    selector: '[data-tour="quoter-header"]',
    title: 'Nombre y cliente',
    description:
      'Los dos datos obligatorios de la cotización. El nombre es como la vas a encontrar después en la lista; el cliente es quien la va a aprobar.',
  },
  {
    selector: '[data-tour="quoter-stats"]',
    title: 'Semáforo de captura',
    description:
      'Cuántos productos hay y cuántos siguen incompletos: <b>Sin datos</b> (naranja) no tienen precio o descripción; <b>Sin cantidad</b> (amarillo) les falta cuánto pidió el cliente. La cotización se puede guardar como borrador aunque falten, pero no enviarse a aprobación.',
  },
  {
    selector: '[data-tour="quoter-toolbar"]',
    title: 'Total y herramientas de la tabla',
    description:
      'El total se calcula en vivo con los productos completos (los separadores y los "no lo vendemos" nunca suman). Desde aquí también agregas productos manuales y eliges qué columnas ver.',
    side: 'bottom',
  },
  {
    selector: '[data-tour="quoter-table"]',
    title: 'La tabla editable',
    description:
      'Cada fila es un renglón del Excel del cliente. Edita precio, cantidad y entrega directo en la celda; el lápiz abre el detalle completo. Los <b>separadores</b> agrupan por secciones (con su color), y puedes reordenar arrastrando o con las flechas.',
  },
  {
    selector: '[data-tour="quoter-save"]',
    title: 'Guardar',
    description:
      'Guarda la cotización como borrador. Lo que el sistema aprendió de esta captura (precios, marcas, descripciones curadas) se recuerda para pre-llenar la próxima — cada cotización enseña al catálogo.',
    side: 'top',
  },
]
