import type { OverviewStep } from '@/lib/tours'

/** Finance overview (#120): the month's two halves and the closing they produce. */
export const FINANCE_OVERVIEW_TOUR: OverviewStep[] = [
  {
    selector: '[data-tour="fin-month"]',
    title: 'El mes manda',
    description:
      'Todo lo que ves abajo es de este mes. Cambia de mes con las flechas; <b>Hoy</b> te regresa al actual. Los egresos cuentan por la fecha <b>real</b> en que se pagaron y los ingresos por la fecha en que entró el dinero — el mismo criterio de los dos lados.',
    side: 'bottom',
  },
  {
    selector: '[data-tour="fin-expenses"]',
    title: 'Egresos: los gastos propios',
    description:
      'Lo que DYMMSA debe y pagó, registrado en <b>Facturas por pagar</b>. <b>Pendiente del mes</b> es lo que vence en este mes; <b>Vencido</b> cuenta lo atrasado aunque venga de meses anteriores; <b>Pagado</b> es lo que ya salió. Las canceladas no cuentan en nada.',
  },
  {
    selector: '[data-tour="fin-income"]',
    title: 'Ingresos: leídos de Odoo',
    description:
      'La facturación a clientes vive en Odoo y aquí solo se <b>lee</b>: lo cobrado del mes, lo facturado que vence hoy o después y lo <b>vencido por cobrar</b> de cualquier mes. Se refresca cada 15 minutos; <b>Actualizar</b> lo trae en el momento. Si Odoo no responde, la pantalla sigue con los egresos.',
  },
  {
    selector: '[data-tour="fin-closing"]',
    title: 'El cierre del mes',
    description:
      '<b>Real</b> = cobrado − pagado: el dinero que de verdad se movió. <b>Proyectado</b> le resta además lo pendiente del mes y lo vencido de meses previos: cómo cerraría si se pagara todo lo que se debe. Es la cifra para planear el pago de impuestos; un número negativo es una respuesta válida.',
  },
  {
    selector: '[data-tour="fin-due-weeks"]',
    title: 'Qué vence cada semana',
    description:
      'Las facturas pendientes del mes agrupadas por semana de vencimiento, para decidir qué pagar y cuándo. <b>Ver todas</b> abre Facturas por pagar con la lista completa.',
  },
  {
    selector: '[data-tour="fin-credit-notes"]',
    title: 'Notas de crédito sin aplicar',
    description:
      'Saldo <b>a favor del cliente</b> que sigue abierto en Odoo. No es deuda, y por eso <b>no se resta</b> del por cobrar ni del vencido: no se sabe si el cliente lo usará o si se aplicará a una factura. Está aquí para que lo tengas presente antes de cobrar.',
    side: 'top',
  },
]
