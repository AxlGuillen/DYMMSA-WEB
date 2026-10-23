/**
 * Manifest types, the budget and the app tools still registered inline (#118). Tools defined with
 * defineTool (#155 A3) bring their own docs; src/lib/mcp/catalog.ts joins both for docs and consent.
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
  /**
   * Admin-only tool (#133): not registered for a member, not in the in-app docs every member
   * reads. The RLS is still the barrier; this only trims the list the model sees.
   */
  adminOnly?: true
}

export type McpRole = 'admin' | 'member'

/** App tools still registered inline in server.ts; each moves to its definition in #155 A3b. */
export const APP_MANIFEST: readonly ToolManifestEntry[] = [
  { name: 'get_business_summary', block: 'app', module: 'Panorama', kind: 'read', title: 'Resumen del negocio', example: '¿Como vamos? Dame el panorama general.' },
  { name: 'list_quotations', block: 'app', module: 'Cotizaciones', kind: 'read', title: 'Listar cotizaciones', example: '¿Que cotizaciones esperan aprobacion?' },
  { name: 'get_quotation', block: 'app', module: 'Cotizaciones', kind: 'read', title: 'Detalle de cotizacion', example: '¿Que aprobo el cliente de la cotizacion de Andritz y ya tiene orden?' },
  { name: 'list_orders', block: 'app', module: 'Ordenes', kind: 'read', title: 'Listar ordenes', example: '¿Que ordenes siguen abiertas?' },
  { name: 'get_order', block: 'app', module: 'Ordenes', kind: 'read', title: 'Detalle de orden', example: '¿Que falta por recibir de URREA en la orden 12?' },
  { name: 'get_cut_plan', block: 'app', module: 'Ordenes', kind: 'read', title: 'Lista de corte de una orden', example: '¿Cuanto tubo necesito para la orden 12 y cuantas barras salen?' },
  { name: 'save_material_presentation', block: 'app', module: 'Ordenes', kind: 'write', title: 'Registrar medida de material', example: 'Agrega barra de tubo de 1 pulgada de 6 metros.', limits: 'Solo registra barras de tubo u hojas de placa, en mm. No borra medidas ni toca la lista de corte.' },
  { name: 'get_purchase_plan', block: 'app', module: 'Ordenes', kind: 'read', title: 'Planificador de compra', example: '¿Que va a mayoreo y que a menudeo en la orden 12?' },
  { name: 'search_inventory', block: 'app', module: 'Inventario', kind: 'read', title: 'Buscar en inventario', example: '¿Tenemos el 6954 y en que gaveta esta?' },
  { name: 'set_inventory_location', block: 'app', module: 'Inventario', kind: 'write', title: 'Asignar ubicacion en tienda', example: 'El 6954 quedo en la gaveta B3.', limits: 'Solo la gaveta de un producto ya inventariado. Nunca toca cantidades.' },
  { name: 'search_products', block: 'app', module: 'Catalogos', kind: 'read', title: 'Buscar productos ETM', example: 'Busca el ETM del rodillo de 9 pulgadas.' },
  { name: 'search_urrea_catalog', block: 'app', module: 'Catalogos', kind: 'read', title: 'Consultar catalogo URREA', example: '¿Cuantas piezas trae el paquete del 6954?' },
  { name: 'list_suppliers', block: 'app', module: 'Proveedores', kind: 'read', title: 'Proveedores de menudeo', example: '¿Quien me surte SURTEK y que plazo da?' },
  { name: 'save_supplier', block: 'app', module: 'Proveedores', kind: 'write', title: 'Guardar proveedor', example: 'Da de alta a Tornillos MX, 30 dias de credito, surte SURTEK.', limits: 'Alta o edicion de contacto, dias de credito y marcas ya registradas. No borra proveedores ni crea marcas.' },
  { name: 'list_payables', block: 'app', module: 'Finanzas', kind: 'read', title: 'Facturas por pagar', example: '¿Que facturas vencen este mes?' },
  { name: 'get_payable', block: 'app', module: 'Finanzas', kind: 'read', title: 'Detalle de factura por pagar', example: 'Dame el detalle de la factura de Perfiles.' },
  { name: 'get_payables_overview', block: 'app', module: 'Finanzas', kind: 'read', title: 'Resumen de facturas por pagar', example: '¿Que debo esta semana?' },
  { name: 'mark_payable_paid', block: 'app', module: 'Finanzas', kind: 'write', title: 'Marcar factura pagada', example: 'Ya pague la de Perfiles, marcala.', limits: 'Marca pagada con la fecha real o regresa a pendiente. No edita montos ni borra facturas.' },
  { name: 'create_payable', block: 'app', module: 'Finanzas', kind: 'write', title: 'Registrar factura por pagar', example: 'Registra una factura de Tornillos MX por $2,500 con fecha de hoy.', limits: 'Nace pendiente; el vencimiento sale del plazo del proveedor, como en la app. Moneda MXN por default o USD; nunca se convierte.' },
  { name: 'update_payable', block: 'app', module: 'Finanzas', kind: 'write', title: 'Corregir o cancelar factura por pagar', example: 'La factura de Perfiles era por $3,200, no $2,300.', limits: 'Corrige concepto, monto, moneda (MXN o USD, sin convertir), fechas, proveedor o notas, o la cancela. No la paga, no la borra ni reactiva una cancelada.' },
  { name: 'get_month_closing', block: 'app', module: 'Finanzas', kind: 'read', title: 'Cierre del mes', example: '¿Como cierra el mes?' },
  { name: 'get_week_hours', block: 'app', module: 'Horas', kind: 'read', title: 'Horas de la semana', example: '¿Cuantas horas llevo esta semana?' },
  { name: 'get_hours_trend', block: 'app', module: 'Horas', kind: 'read', title: 'Tendencia de horas', example: '¿Como viene Tania en las ultimas semanas?' },
  { name: 'list_time_imports', block: 'app', module: 'Horas', kind: 'read', title: 'Cargas del checador', example: '¿Cuando se cargo el ultimo reporte del checador?', adminOnly: true },
  { name: 'preview_time_report', block: 'app', module: 'Horas', kind: 'read', title: 'Revisar reporte del checador', example: 'Revisa el reporte del checador de esta semana antes de cargarlo.', adminOnly: true },
  { name: 'save_time_entries', block: 'app', module: 'Horas', kind: 'write', title: 'Guardar checadas', example: 'Este es el reporte del checador de la semana, cargalo. / A Tania le falto la salida del miercoles, salio a las 6.', limits: 'Carga el reporte (no duplica, no pisa correcciones y no guarda nada si no cuadra con sus totales) o corrige/registra una checada, conservando lo que dijo el checador. No borra checadas.', adminOnly: true },
  { name: 'save_excused_day', block: 'app', module: 'Horas', kind: 'write', title: 'Guardar dia justificado', example: 'El lunes fue feriado.', limits: 'Feriados y salidas autorizadas, para el equipo o una persona; marca, cambia o quita.', adminOnly: true },
  { name: 'get_profiles', block: 'app', module: 'Perfil', kind: 'read', title: 'Perfiles del equipo', example: '¿Cual es mi NSS?' },
  { name: 'get_payroll_period', block: 'app', module: 'Nomina', kind: 'read', title: 'Corte de nomina', example: '¿Cuantas horas lleva cada quien en el corte de esta semana?', adminOnly: true },
  { name: 'record_payroll_hours', block: 'app', module: 'Nomina', kind: 'write', title: 'Cargar horas de nomina', example: 'Esta es la hoja de asistencia de la semana, cargala.', limits: 'Solo borradores: no confirma, no cierra cortes, no pisa lo ya confirmado ni crea empleados. Tambien trae las horas del checador de la oficina, como el boton Traer de Horas.', adminOnly: true },
  { name: 'save_payroll_employee', block: 'app', module: 'Nomina', kind: 'write', title: 'Guardar empleado de nomina', example: 'Da de alta a un trabajador nuevo en el taller, medio tiempo.', limits: 'Alta, cambios y baja (desactivar, nunca borrar). No toca horas ni cortes.', adminOnly: true },
  { name: 'list_tasks', block: 'app', module: 'Tareas', kind: 'read', title: 'Listar tareas', example: '¿Que tareas siguen abiertas?' },
  { name: 'get_task', block: 'app', module: 'Tareas', kind: 'read', title: 'Detalle de tarea', example: '¿Que dice la tarea 45?' },
  { name: 'create_task', block: 'app', module: 'Tareas', kind: 'write', title: 'Crear tarea', example: 'Registra una tarea: revisar los precios de Truper.', limits: 'Queda reportada por el asistente.' },
  { name: 'update_task', block: 'app', module: 'Tareas', kind: 'write', title: 'Actualizar tarea', example: 'Cierra la tarea 45 y comenta que ya quedo.', limits: 'Comenta, cambia prioridad, cierra o reabre. Nunca reescribe el titulo ni la descripcion.' },
  { name: 'get_app_settings', block: 'app', module: 'Configuracion', kind: 'read', title: 'Configuracion de la app', example: '¿Que umbrales tiene el planificador de compra?' },

]

/**
 * Budget every tool must fit in (#133, ADR-034). Raising a cap is an explicit decision in the
 * PR, with its why: each new tool has to earn its place or replace another.
 */
export const TOOL_BUDGET = {
  /** Odoo 16 → 20 for the four #144 writes (ADR-040, decided 2026-10-16). */
  tools: { app: 36, odoo: 20 },
  /** Characters of description per tool; the exceptions carry a guide the model needs in full. */
  description: 1000,
  descriptionExceptions: { record_payroll_hours: 2600 } as Record<string, number>,
  /** 18,000 → 18,500 for the #134 writes (ADR-037); → 20,000 for the four Odoo tools of #144 (ADR-040). */
  descriptionsTotal: 20_000,
  /** Characters of the admin's tools/list on the wire, every field included (#155 A1). The 47,000 of #144 measured a proxy
   *  without annotations or JSON structure; on the wire the same list is 53,163, and 54,000 leaves ~1.6% of slack. */
  listTotal: 54_000,
  /** Characters of the server instructions, per role. 7,500 → 8,000 for the admin's Odoo write flow (#144). */
  instructions: 8000,
} as const

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
