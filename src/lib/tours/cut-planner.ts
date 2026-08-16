import type { OverviewStep } from '@/lib/tours'

/**
 * Overview del planificador de corte (issue #59): explica el diseño de "dos
 * momentos" del módulo — lista de piezas → necesidad neta, y captura de la
 * presentación del proveedor → diagrama de acomodo (ADR-022).
 */
export const CUT_PLANNER_TOUR: OverviewStep[] = [
  {
    selector: '[data-tour="cut-candidates"]',
    title: 'Piezas DYMMSA de la orden',
    description:
      'Los productos marca DYMMSA de esta orden (los que se mandan a hacer). Con <b>Tubo</b> o <b>Placa</b> los pasas a la lista de corte; si el producto tiene medidas nominales en el catálogo, se pre-llenan solas.',
  },
  {
    selector: '[data-tour="cut-tubes"]',
    title: 'Lista de corte — tubos',
    description:
      'Cada fila es una pieza a cortar: diámetro, longitud y cantidad, todo en <b>mm</b>. "Pedido original" registra qué pidió el cliente con sus palabras. Una fila en ámbar está incompleta y no entra al cálculo.',
  },
  {
    selector: '[data-tour="cut-plates"]',
    title: 'Lista de corte — placas',
    description:
      'Igual que los tubos, pero con espesor, ancho y largo. Las placas se agrupan por espesor y se compran como HOJAS de medida fija del proveedor.',
  },
  {
    selector: '[data-tour="cut-group-tube"]',
    title: 'Necesidad por diámetro',
    description:
      'El corazón del módulo. El sistema suma cuánto material pedir ("pedir 1.62 m"). Cuando el proveedor te diga qué barra vende, <b>captúrala aquí</b>: en ese momento se dibuja el acomodo de cortes con su sobrante, y con las flechas ◀ ▶ puedes mover piezas entre barras. Las barras capturadas se recuerdan como chips para la próxima vez.',
  },
  {
    selector: '[data-tour="cut-group-plate"]',
    title: 'Necesidad por espesor de placa',
    description:
      'Para placas capturas la <b>hoja del proveedor</b> (ancho × largo); el sistema acomoda las piezas en cada hoja (vista aérea) y te dice cuántas hojas pedir, el sobrante y el aprovechamiento. Las hojas capturadas se recuerdan como chips.',
  },
  {
    selector: '[data-tour="cut-margin"]',
    title: 'Margen por corte',
    description:
      'Los mm que se come cada corte de sierra (se cobra por partición). Cambiarlo recalcula todos los acomodos y queda guardado como ajuste global del sistema.',
    // En el header: abajo explícito para no tapar la barra de acciones (PR #62).
    side: 'bottom',
  },
  {
    selector: '[data-tour="cut-actions"]',
    title: 'Excel e impresión',
    description:
      '<b>Excel pedido</b> genera el archivo para el proveedor con la necesidad neta por medida. <b>Imprimir</b> saca los diagramas de corte en limpio para el taller.',
    side: 'bottom',
  },
  {
    selector: '[data-tour="cut-save"]',
    title: 'Guardar lista de corte',
    description:
      'Persiste la lista completa de la orden (reemplaza lo anterior) y registra las barras capturadas en el catálogo de presentaciones. El acomodo manual no se guarda: es una herramienta visual del momento.',
  },
]
