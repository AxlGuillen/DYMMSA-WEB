import type { OverviewStep } from '@/lib/tours'

/** Quoter overview (#74): covers both moments; the absent one skips itself. */
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
      'Cuántos productos hay, cuántos están completos y cuántos siguen incompletos: <b>Sin datos</b> (naranja) no traen descripción ni código de modelo; <b>Sin cantidad</b> (amarillo) les falta cuánto pidió el cliente. Para guardar, cada producto necesita <b>ETM y cantidad mayor a 0</b> (salvo los "no lo vendemos"); el precio puede quedar vacío.',
  },
  {
    selector: '[data-tour="quoter-toolbar"]',
    title: 'Total y herramientas de la tabla',
    description:
      'El total se calcula en vivo con los productos que ya tienen precio y cantidad (los separadores y los "no lo vendemos" nunca suman). Desde aquí también agregas productos manuales y eliges qué columnas ver.',
    side: 'bottom',
  },
  {
    selector: '[data-tour="quoter-table"]',
    title: 'La tabla editable',
    description:
      'Cada fila es un renglón del Excel del cliente. El <b>lápiz</b> abre el producto para editar precio, cantidad, entrega y el resto de sus datos. Los <b>separadores</b> agrupan por secciones: su nombre se escribe directo en la fila y llevan su color. Reordena arrastrando (con más de 300 productos, con las flechas).',
  },
  {
    selector: '[data-tour="quoter-save"]',
    title: 'Guardar',
    description:
      'Guarda la cotización como borrador y abre su detalle; si a un producto le falta un dato obligatorio, te avisa y marca su fila en rojo. Lo que el sistema aprendió de esta captura (precios, marcas, descripciones curadas) se recuerda para pre-llenar la próxima — cada cotización enseña al catálogo.',
    side: 'top',
  },
]
