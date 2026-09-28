import type { OverviewStep } from '@/lib/tours'

/** Payables overview (#120): register, find, and mark paid with the real date. */
export const PAYABLES_TOUR: OverviewStep[] = [
  {
    selector: '[data-tour="pay-new"]',
    title: 'Registrar una factura',
    description:
      'Proveedor, concepto, monto y fecha de factura. El <b>vencimiento</b> se pre-llena con los días de crédito del proveedor (los que capturaste en Proveedores) y puedes ajustarlo. Toda factura nace <b>pendiente</b>.',
    side: 'bottom',
  },
  {
    selector: '[data-tour="pay-filters"]',
    title: 'Encontrar la factura',
    description:
      'La barra busca por <b>concepto</b>. Los demás filtros acotan por estado, proveedor, <b>mes de vencimiento</b> y rango de monto. El formato de las fechas se elige aquí mismo y aplica también en Horas.',
  },
  {
    selector: '[data-tour="pay-table"]',
    title: 'Vencimientos y pagos',
    description:
      'Un vencimiento en <b>rojo</b> ya pasó; en <b>ámbar</b> cae en los próximos 7 días. El ✓ marca pagada con la fecha de <b>hoy</b>; si pagaste otro día, edita con el lápiz y captura la fecha real — es la que alimenta el cierre del mes en Finanzas. Si eres administrador también ves quién la marcó pagada.',
  },
]
