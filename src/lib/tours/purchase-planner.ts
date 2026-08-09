import type { OverviewStep } from '@/lib/tours'

/**
 * Overview del planificador de compra (issue #54, ADR-018): explica el modelo
 * mayoreo vs menudeo — cantidades consolidadas contra el STD del catálogo,
 * la recomendación por umbrales de dinero/porcentaje parado, y por qué los
 * Excel salen de las decisiones GUARDADAS.
 */
export const PURCHASE_PLANNER_TOUR: OverviewStep[] = [
  {
    selector: '[data-tour="plan-summary"]',
    title: 'La compra de un vistazo',
    description:
      'Cuánto <b>dinero se queda parado</b> al redondear a paquete, cuánto <b>ahorras</b> mandando restos a menudeo, y cómo queda repartida la compra entre URREA y local. Se recalcula al instante con cada decisión que cambies, sin guardar.',
  },
  {
    selector: '[data-tour="plan-thresholds"]',
    title: 'Umbrales de decisión',
    description:
      'Las dos perillas de la recomendación: el <b>dinero parado máximo</b> y el <b>% del paquete</b> que aceptas parar. Son ajuste global del sistema; al cambiarlos se recalcula el plan y te dice cuántos productos cambiaron de recomendación.',
    // En el header: abajo explícito para no tapar la barra de controles.
    side: 'bottom',
  },
  {
    selector: '[data-tour="plan-view-toggle"]',
    title: 'Dos formas de ver el plan',
    description:
      'La <b>vista agrupada</b> consolida por código+marca (así corre la matemática); la <b>vista plana</b> lista todas las líneas sueltas de la orden, útil para rastrear de qué sección salió cada cantidad.',
    side: 'bottom',
  },
  {
    selector: '[data-tour="plan-groups"]',
    title: 'Candidatos a pedido URREA',
    description:
      'Aquí vive la decisión. Cada grupo suma las cantidades de TODA la orden para un mismo código+marca y las compara contra el <b>STD</b> (piezas por paquete) del catálogo: pedir 25 con STD 10 significa 2 paquetes exactos y un resto de 5 por decidir.',
  },
  {
    selector: '[data-tour="plan-group"]',
    title: 'Anatomía de un grupo',
    description:
      'El color dice la decisión (verde mayoreo, azul mixto, naranja menudeo, ámbar por revisar). Eliges con el radio: <b>redondear a paquete</b> (queda parado), <b>mixto</b> (paquetes a URREA y el resto a menudeo) o <b>todo a menudeo</b>. La flecha ▸ abre las líneas de origen.',
  },
  {
    selector: '[data-tour="plan-local"]',
    title: 'Compra local',
    description:
      'Lo que no cruza con el catálogo URREA se compra en proveedores locales. Los restos que mandes a menudeo desde los grupos de arriba también terminan en el Excel de compra local.',
  },
  {
    selector: '[data-tour="plan-actions"]',
    title: 'Los dos Excel',
    description:
      '<b>Pedido URREA</b> sale de las decisiones GUARDADAS (piezas en múltiplos de STD): si tienes cambios en pantalla, el botón guarda y descarga en un solo paso; con grupos "por revisar" no genera y te avisa. <b>Compra local</b> arma el listado para el menudeo.',
    // El footer es fijo al fondo: el popover abre hacia arriba.
    side: 'top',
  },
  {
    selector: '[data-tour="plan-save"]',
    title: 'Guardar decisiones',
    description:
      'Persiste la decisión de cada grupo para esta orden. El contador de la izquierda te dice cuántos grupos faltan por revisar; si el catálogo o las cantidades cambian después, el grupo se marca <b>Desactualizada</b> para que la reconfirmes.',
    side: 'top',
  },
]
