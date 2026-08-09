import type { OverviewStep } from '@/lib/tours'

/**
 * Overview de la entrada al sistema: el sidebar (qué vive en cada sección del
 * menú) y el panel de inicio. Es lo primero que ve alguien nuevo — el tour
 * presenta el mapa completo antes de que entre a cualquier módulo.
 */
export const DASHBOARD_TOUR: OverviewStep[] = [
  {
    selector: '[data-tour="nav-main"]',
    title: 'El flujo principal',
    description:
      'El camino de una venta vive aquí: en <b>Cotizaciones</b> están las cotizaciones con su estado (borrador, en revisión, aprobada…) y en <b>Órdenes</b> lo ya aprobado se convierte en pedido, recepción y entrega. <b>Inicio</b> es este panel.',
    side: 'right',
  },
  {
    selector: '[data-tour="nav-etm"]',
    title: 'ETM — Catálogo',
    description:
      'La <b>Base de datos</b> guarda los productos ETM conocidos (código, precio, descripción DYMMSA). El <b>Matcher</b> es el cotizador: ahí subes el Excel del cliente y el sistema cruza sus claves ETM contra el catálogo.',
    side: 'right',
  },
  {
    selector: '[data-tour="nav-dymmsa"]',
    title: 'DYMMSA',
    description:
      'Lo propio de la tienda: el <b>Inventario</b> físico con sus ubicaciones (gavetas) y los <b>Proveedores</b> de menudeo con las marcas que maneja cada uno.',
    side: 'right',
  },
  {
    selector: '[data-tour="nav-urrea"]',
    title: 'URREA',
    description:
      'El <b>Catálogo</b> oficial multimarca (URREA, SURTEK, FOY…) con las unidades por paquete (STD). Es la base del planificador de compra mayoreo vs menudeo.',
    side: 'right',
  },
  {
    selector: '[data-tour="nav-recursos"]',
    title: 'Recursos',
    description:
      '<b>Tareas</b> del equipo (reportes y pendientes con prioridad), <b>Novedades</b> (qué cambió en el sistema, en lenguaje simple) y la <b>Documentación</b>.',
    side: 'right',
  },
  {
    selector: '[data-tour="nav-prefs"]',
    title: 'Tu sesión',
    description:
      'Sonidos de la interfaz, <b>modo discreto</b> (oculta los montos cuando hay gente mirando la pantalla), tema claro/oscuro y cierre de sesión.',
    side: 'right',
  },
  {
    selector: '[data-tour="dash-metrics"]',
    title: 'El pulso del negocio',
    description:
      'Métricas del periodo que elijas (7 días, 30, el mes o un rango a la medida): catálogo, inventario, órdenes por estado y ventas cerradas, con las órdenes más recientes a la mano.',
    side: 'top',
  },
]
