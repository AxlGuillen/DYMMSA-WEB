/**
 * What the assistant can do, in one place (#118). The docs page renders this and
 * tests/mcp/manifest.test.ts fails when server.ts registers a tool that is not listed here —
 * so the in-app documentation of the MCP cannot go stale.
 */

export type ToolBlock = 'app' | 'odoo'
export type ToolKind = 'read' | 'write'

export interface ToolManifestEntry {
  name: string
  block: ToolBlock
  /** Group shown in the docs (one per screen/module). */
  module: string
  kind: ToolKind
  title: string
  /** A question the user could ask that lands on this tool. */
  example: string
  /** Writes only: what the tool will never do. */
  limits?: string
}

export const TOOL_MANIFEST: readonly ToolManifestEntry[] = [
  // Block A — the app
  { name: 'get_business_summary', block: 'app', module: 'Panorama', kind: 'read', title: 'Resumen del negocio', example: '¿Como vamos? Dame el panorama general.' },
  { name: 'list_quotations', block: 'app', module: 'Cotizaciones', kind: 'read', title: 'Listar cotizaciones', example: '¿Que cotizaciones esperan aprobacion?' },
  { name: 'get_quotation', block: 'app', module: 'Cotizaciones', kind: 'read', title: 'Detalle de cotizacion', example: '¿Que aprobo el cliente de la cotizacion de Andritz?' },
  { name: 'get_quotation_stats', block: 'app', module: 'Cotizaciones', kind: 'read', title: 'Metricas de cotizaciones', example: '¿Cuantas cotizaciones hay por estado?' },
  { name: 'list_orders', block: 'app', module: 'Ordenes', kind: 'read', title: 'Listar ordenes', example: '¿Que ordenes siguen abiertas?' },
  { name: 'get_order', block: 'app', module: 'Ordenes', kind: 'read', title: 'Detalle de orden', example: '¿Que falta por recibir de URREA en la orden 12?' },
  { name: 'get_order_by_quotation', block: 'app', module: 'Ordenes', kind: 'read', title: 'Orden de una cotizacion', example: '¿Ya tiene orden la cotizacion de FieldCore?' },
  { name: 'get_cut_plan', block: 'app', module: 'Ordenes', kind: 'read', title: 'Lista de corte de una orden', example: '¿Cuanto tubo necesito para la orden 12 y cuantas barras salen?' },
  { name: 'get_purchase_plan', block: 'app', module: 'Ordenes', kind: 'read', title: 'Planificador de compra', example: '¿Que va a mayoreo y que a menudeo en la orden 12?' },
  { name: 'search_inventory', block: 'app', module: 'Inventario', kind: 'read', title: 'Buscar en inventario', example: '¿Tenemos el 6954 y en que gaveta esta?' },
  { name: 'get_inventory_stats', block: 'app', module: 'Inventario', kind: 'read', title: 'Metricas de inventario', example: '¿Cuantos productos estan sin stock?' },
  { name: 'set_inventory_location', block: 'app', module: 'Inventario', kind: 'write', title: 'Asignar ubicacion en tienda', example: 'El 6954 quedo en la gaveta B3.', limits: 'Solo la gaveta de un producto ya inventariado. Nunca toca cantidades.' },
  { name: 'search_products', block: 'app', module: 'Catalogos', kind: 'read', title: 'Buscar productos ETM', example: 'Busca el ETM del rodillo de 9 pulgadas.' },
  { name: 'search_urrea_catalog', block: 'app', module: 'Catalogos', kind: 'read', title: 'Consultar catalogo URREA', example: '¿Cuantas piezas trae el paquete del 6954?' },
  { name: 'list_suppliers', block: 'app', module: 'Proveedores', kind: 'read', title: 'Proveedores de menudeo', example: '¿Quien me surte SURTEK y que plazo da?' },
  { name: 'list_payables', block: 'app', module: 'Finanzas', kind: 'read', title: 'Facturas por pagar', example: '¿Que facturas vencen este mes?' },
  { name: 'get_payable', block: 'app', module: 'Finanzas', kind: 'read', title: 'Detalle de factura por pagar', example: 'Dame el detalle de la factura de Perfiles.' },
  { name: 'get_payables_overview', block: 'app', module: 'Finanzas', kind: 'read', title: 'Resumen de facturas por pagar', example: '¿Que debo esta semana?' },
  { name: 'mark_payable_paid', block: 'app', module: 'Finanzas', kind: 'write', title: 'Marcar factura pagada', example: 'Ya pague la de Perfiles, marcala.', limits: 'Marca pagada con la fecha real o regresa a pendiente. No edita montos ni borra facturas.' },
  { name: 'create_payable', block: 'app', module: 'Finanzas', kind: 'write', title: 'Registrar factura por pagar', example: 'Registra una factura de Tornillos MX por $2,500 con fecha de hoy.', limits: 'Nace pendiente; el vencimiento sale del plazo del proveedor, como en la app.' },
  { name: 'get_month_closing', block: 'app', module: 'Finanzas', kind: 'read', title: 'Cierre del mes', example: '¿Como cierra el mes?' },
  { name: 'get_week_hours', block: 'app', module: 'Horas', kind: 'read', title: 'Horas de la semana', example: '¿Cuantas horas llevo esta semana?' },
  { name: 'get_hours_trend', block: 'app', module: 'Horas', kind: 'read', title: 'Tendencia de horas', example: '¿Como viene Tania en las ultimas semanas?' },
  { name: 'list_time_imports', block: 'app', module: 'Horas', kind: 'read', title: 'Cargas del checador', example: '¿Cuando se cargo el ultimo reporte del checador?' },
  { name: 'list_tasks', block: 'app', module: 'Tareas', kind: 'read', title: 'Listar tareas', example: '¿Que tareas siguen abiertas?' },
  { name: 'get_task', block: 'app', module: 'Tareas', kind: 'read', title: 'Detalle de tarea', example: '¿Que dice la tarea 45?' },
  { name: 'create_task', block: 'app', module: 'Tareas', kind: 'write', title: 'Crear tarea', example: 'Registra una tarea: revisar los precios de Truper.', limits: 'Queda reportada por el asistente.' },
  { name: 'update_task', block: 'app', module: 'Tareas', kind: 'write', title: 'Actualizar tarea', example: 'Cierra la tarea 45 y comenta que ya quedo.', limits: 'Comenta, cambia prioridad, cierra o reabre. Nunca reescribe el titulo ni la descripcion.' },
  { name: 'get_app_settings', block: 'app', module: 'Configuracion', kind: 'read', title: 'Configuracion de la app', example: '¿Que umbrales tiene el planificador de compra?' },

  // Block B — Odoo (the company's official invoicing, read-only)
  { name: 'odoo_query', block: 'odoo', module: 'Consultas libres', kind: 'read', title: 'Consulta generica en Odoo', example: 'Facturas de GE de agosto con su estado de pago.' },
  { name: 'odoo_aggregate', block: 'odoo', module: 'Consultas libres', kind: 'read', title: 'Agregados en Odoo', example: 'Total facturado por cliente este año.' },
  { name: 'odoo_overdue_invoices', block: 'odoo', module: 'Contabilidad', kind: 'read', title: 'Cartera vencida', example: '¿Quien nos debe y desde cuando?' },
  { name: 'odoo_invoices_summary', block: 'odoo', module: 'Contabilidad', kind: 'read', title: 'Resumen de facturacion', example: '¿Como cerro julio en facturacion?' },
  { name: 'odoo_invoice_detail', block: 'odoo', module: 'Contabilidad', kind: 'read', title: 'Detalle de factura', example: 'El detalle de la factura F00167, con su timbrado.' },
  { name: 'odoo_payment_detail', block: 'odoo', module: 'Contabilidad', kind: 'read', title: 'Detalle de pago con su REP', example: '¿El pago PAY00068 ya tiene su complemento?' },
  { name: 'odoo_rep_audit', block: 'odoo', module: 'Contabilidad', kind: 'read', title: 'Auditoria de complementos de pago', example: '¿Que pagos del mes se quedaron sin REP?' },
  { name: 'odoo_invoice_link_check', block: 'odoo', module: 'Contabilidad', kind: 'read', title: 'Facturas sin orden de venta', example: '¿Que facturas del mes no estan ligadas a su orden de venta?' },
  { name: 'odoo_sales_summary', block: 'odoo', module: 'Ventas y cobranza', kind: 'read', title: 'Resumen de ventas', example: 'Ventas confirmadas por vendedor este mes.' },
  { name: 'odoo_customer_profile', block: 'odoo', module: 'Ventas y cobranza', kind: 'read', title: 'Perfil de cliente', example: 'El expediente completo de FieldCore.' },
  { name: 'odoo_receivables_ranking', block: 'odoo', module: 'Ventas y cobranza', kind: 'read', title: 'Ranking de cobranza', example: '¿A quien le cobro primero? ¿Quien paga mas lento?' },
  { name: 'odoo_sale_detail', block: 'odoo', module: 'Ventas y cobranza', kind: 'read', title: 'Detalle de venta', example: '¿Ya se entrego y facturo todo lo de la venta S00247?' },
  { name: 'odoo_stock_check', block: 'odoo', module: 'Operacion', kind: 'read', title: 'Existencias en Odoo', example: '¿Cuantas puntas de cobre hay en el almacen de Odoo?' },
  { name: 'odoo_employee_directory', block: 'odoo', module: 'Operacion', kind: 'read', title: 'Directorio de empleados', example: '¿Cual es el correo de trabajo de Diego?' },
  { name: 'odoo_fleet_status', block: 'odoo', module: 'Operacion', kind: 'read', title: 'Estado de la flotilla', example: '¿Que vehiculos tienen servicio reciente?' },
]

export const manifestFor = (block: ToolBlock) => TOOL_MANIFEST.filter((t) => t.block === block)

/** Entries grouped by module, in first-appearance order. */
export function groupByModule(entries: readonly ToolManifestEntry[]): { module: string; tools: ToolManifestEntry[] }[] {
  const groups = new Map<string, ToolManifestEntry[]>()
  for (const entry of entries) {
    const list = groups.get(entry.module) ?? []
    list.push(entry)
    groups.set(entry.module, list)
  }
  return [...groups.entries()].map(([module, tools]) => ({ module, tools }))
}
