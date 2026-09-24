/** MCP tool registry: reads + 5 scoped writes (ADR-015, ADR-030). Each call's db comes from the OAuth token, no service_role (ADR-023). */

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import { GitHubError } from '@/lib/github'
import { OdooError, callOdoo } from '@/lib/odoo/client'
import { ToolError, type Db } from './shared'
import { contextFrom, type McpContext } from './context'
import { odooQuery, odooAggregate, odooOverdueInvoices, odooInvoicesSummary } from './tools/odoo/accounting'
import { odooSalesSummary, odooCustomerProfile } from './tools/odoo/sales'
import { odooStockCheck, odooEmployeeDirectory, odooFleetStatus } from './tools/odoo/operations'
import { odooInvoiceDetail, odooSaleDetail } from './tools/odoo/documents'
import { odooPaymentDetail, odooRepAudit } from './tools/odoo/payments'
import { odooInvoiceLinkCheck } from './tools/odoo/links'
import { odooReceivablesRanking } from './tools/odoo/receivables'
import { listQuotations, getQuotation, getQuotationStats } from './tools/quotations'
import { listOrders, getOrder, getOrderByQuotation } from './tools/orders'
import { searchInventory, getInventoryStats, setInventoryLocation } from './tools/inventory'
import { searchProducts } from './tools/products'
import { searchUrreaCatalog } from './tools/urrea'
import { listTasks, getTask, createTask, updateTask } from './tools/tasks'
import { getBusinessSummary } from './tools/summary'
import { getWeekHours, getHoursTrend, listTimeImports } from './tools/hours'
import { listSuppliers } from './tools/suppliers'
import { listPayables, getPayable, getPayablesOverview, markPayablePaid, createPayable } from './tools/payables'
import { getMonthClosing } from './tools/finance'
import { getCutPlan } from './tools/cutting'
import { getPurchasePlan } from './tools/purchase'
import { getAppSettings } from './tools/settings'

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean }

/** The SDK hands the AuthInfo validated by withMcpAuth in each call's extra. */
type ToolExtra = { authInfo?: AuthInfo }

/** Runs the tool with the token's db (RLS applies); expected errors surface their message, the rest go generic.
 *  The context carries the caller's identity for tools that mean "me" (hours, #101). */
async function run(extra: ToolExtra, fn: (db: Db, ctx: McpContext) => Promise<unknown>): Promise<ToolResult> {
  try {
    const ctx = contextFrom(extra.authInfo)
    const data = await fn(ctx.db, ctx)
    return { content: [{ type: 'text', text: JSON.stringify(data) }] }
  } catch (e) {
    if (e instanceof ToolError || e instanceof GitHubError || e instanceof OdooError) {
      return { content: [{ type: 'text', text: e.message }], isError: true }
    }
    console.error('MCP tool error:', e)
    return { content: [{ type: 'text', text: 'Error interno al ejecutar la herramienta' }], isError: true }
  }
}

/** Read-only — every tool except the scoped writes of ADR-015. */
const readOnly = { readOnlyHint: true, openWorldHint: false } as const

const pagination = {
  page: z.number().int().min(1).optional().describe('Página (1-indexada, default 1)'),
  pageSize: z.number().int().min(1).max(100).optional().describe('Resultados por página (default 20, máx 100)'),
}

export const BUSINESS_RULES_MD = `# Reglas de negocio DYMMSA (referencia para el asistente)

- **Flujo**: cotización (draft → sent_for_approval → approved/rejected → converted_to_order) → orden (ordered → received → delivered → completed | cancelled).
- **Separadores** (item_type='separator') son encabezados de sección: nunca cuentan en totales, conteos ni aprobaciones.
- **is_sold es tri-estado**: null = sin definir, true = lo vendemos, false = "no lo vendemos". Solo false excluye el ítem de totales, validación y órdenes; en la página de aprobación aparece como "No disponible".
- **is_approved es tri-estado**: null = pendiente de decisión del cliente, true = aprobado, false = rechazado.
- **Descripción DYMMSA**: jerarquía catálogo URREA oficial > curada DYMMSA > vacía. En cotizaciones guardadas es un snapshot congelado al momento de guardar.
- **Stock**: se deduce al CREAR la orden (no al confirmar recepción). Cancelar/eliminar la orden lo restaura. Invariante: quantity_in_stock + quantity_to_order = quantity_approved.
- **A URREA se pide** lo que está en el catálogo URREA (cualquier marca del catálogo: URREA/SURTEK/FOY…) según las decisiones de mayoreo guardadas: piezas = paquetes × STD. Lo que no está en el catálogo es compra local. urrea_status: pending → supplied/not_supplied.
- **Planificador de compra**: la decisión mayoreo/menudeo es por orden y por grupo (código+marca); "revisar" significa que el usuario DEBE decidir. Solo se persiste la decisión del usuario, la recomendación es al vuelo.
- **Corte**: piezas de tubo/placa que se MANDAN A HACER, siempre en mm; la necesidad neta suma un margen por corte (sobreestima a propósito, es cifra para pedir). El material de corte NO va en el Excel URREA.
- **Inventario**: low_stock = 1..5 piezas; la ubicación (gaveta) solo se muestra si hay stock.
- **Facturas por pagar** = registro propio de GASTOS (Odoo solo factura a clientes). paid_at es la fecha REAL de pago y puede diferir del vencimiento; las vencidas cuentan aunque vengan de meses previos; canceladas no cuentan para nada.
- **Cierre del mes** = cobrado (Odoo) − pagado (app); proyectado = real − pendiente del mes − vencido arrastrado. Sin Odoo el cierre solo refleja egresos.
- **Cambiar el estado de una cotización regenera su approval_token** → el link de aprobación compartido antes muere.
- **Tareas** = GitHub Issues del repo; prioridad por label priority:*, "Descartada" = cerrada como not_planned.
- **Odoo (tools odoo_*)**: la facturación OFICIAL de la empresa vive en Odoo, un sistema EXTERNO a DYMMSA-WEB (solo lectura). Las cotizaciones/órdenes de aquí y las facturas de Odoo son mundos separados — no asumas cruces entre ambos.
- **Vínculo factura↔orden de venta (Odoo)**: la verdad es ordenes_ligadas (el botón "Órdenes de venta" de la factura) y el vínculo línea a línea; origen (invoice_origin) es texto libre y NO prueba el vínculo — una factura con origen pero 0 órdenes ligadas tiene el vínculo roto. Las notas al pie (pedido_pie, "PEDIDO: …") vienen de Odoo, no de capturas.
- Moneda: MXN. Cliente principal: distribuidor URREA en Morelia, México.`

/** Grouping lives here because the MCP tool listing itself is flat (#72). */
export const SERVER_INSTRUCTIONS = `# MCP DYMMSA — mapa de herramientas

Las tools se dividen en DOS bloques que NO se cruzan:

## Bloque A — DYMMSA-WEB (la app de cotizaciones e inventario)
- Panorama: get_business_summary (úsala primero para contexto global).
- Cotizaciones: list_quotations, get_quotation, get_quotation_stats.
- Órdenes: list_orders, get_order, get_order_by_quotation; por orden: get_cut_plan (lista de corte: cuánto tubo/placa pedir) y get_purchase_plan (mayoreo vs menudeo con recomendación y decisiones guardadas).
- Inventario de la TIENDA: search_inventory, get_inventory_stats; escritura acotada set_inventory_location (solo la gaveta, nunca cantidades).
- Catálogos: search_products (ETM), search_urrea_catalog (oficial URREA).
- Proveedores de menudeo: list_suppliers (contacto, plazo de pago, marcas que surte).
- Finanzas de la app: list_payables, get_payable (detalle), get_payables_overview ("¿qué debo esta semana?"), get_month_closing (cierre del mes: egresos de aquí + ingresos leídos de Odoo). Escrituras acotadas: mark_payable_paid (pagada con fecha real, o de regreso a pendiente) y create_payable (registrar una factura de gasto).
- Tareas del equipo: list_tasks, get_task; escrituras create_task y update_task (comentar/priorizar/cerrar).
- Horas del equipo (checador): get_week_hours, get_hours_trend, list_time_imports. Solo lectura. Lo que cada quien ve lo decide la BD por persona: un miembro solo sus propias horas, un administrador las de todos. Son horas de ESTA app (checador NGTeco), sin relación con odoo_employee_directory (Odoo tiene el directorio, no las checadas).
- Configuración: get_app_settings (umbrales del planificador, margen de corte).

## Bloque B — Odoo (prefijo odoo_*, títulos "(Odoo)")
La facturación OFICIAL de la empresa, en un sistema EXTERNO. SOLO lectura.
- Primitivas: odoo_query, odoo_aggregate (cola larga de preguntas sobre el catálogo permitido).
- Contabilidad: odoo_overdue_invoices, odoo_invoices_summary, odoo_invoice_detail, odoo_payment_detail, odoo_rep_audit, odoo_invoice_link_check (facturas del periodo sin orden de venta ligada — la revisión periódica en una llamada).
- Ventas y cobranza: odoo_sales_summary, odoo_customer_profile (incluye la cartera del cliente: deuda total, vencido y días promedio de pago), odoo_sale_detail, odoo_receivables_ranking ("¿a quién le cobro primero?" / "¿quién paga más lento?").
- Operación: odoo_stock_check (almacén de ODOO — no confundir con search_inventory, que es la tienda), odoo_employee_directory, odoo_fleet_status.

Regla de oro: los dos bloques son mundos separados — nunca asumas que una cotización de la app corresponde a una factura de Odoo. Las únicas escrituras del MCP son las cinco del bloque A listadas arriba (set_inventory_location, create_task, update_task, mark_payable_paid, create_payable); todo lo demás es lectura.

Antes de cualquier escritura, di exactamente qué vas a hacer (qué factura/tarea/producto y con qué valores) y espera la confirmación del usuario; si la búsqueda por nombre devuelve varias coincidencias, pregunta cuál en vez de adivinar.

Notas de crédito (Odoo): una nota de crédito sin aplicar es SALDO A FAVOR del cliente, no deuda. Las tools la reportan aparte (campos notas_credito*) y NUNCA la restan del vencido ni del por cobrar — es decisión del negocio (no se sabe si el cliente la usará o si se aplicará a una factura). No hagas ese neteo tú tampoco.

${BUSINESS_RULES_MD}`

export function registerDymmsaTools(server: McpServer): void {
  // Block A — DYMMSA-WEB tools (no title suffix: the app is the default).
  server.registerTool(
    'get_business_summary',
    {
      title: 'Resumen del negocio',
      description:
        'Panorama general de DYMMSA en una llamada: cotizaciones por estado, órdenes por estado, salud del inventario, tamaño de catálogos y tareas abiertas. Úsala primero cuando pregunten "¿cómo vamos?" o necesites contexto global.',
      inputSchema: {},
      annotations: readOnly,
    },
    (_input, extra) => run(extra, (db) => getBusinessSummary(db)),
  )

  server.registerTool(
    'list_quotations',
    {
      title: 'Listar cotizaciones',
      description:
        'Lista cotizaciones con filtros. Úsala para preguntas como "¿qué cotizaciones esperan aprobación?" o buscar por cliente. status: draft | sent_for_approval | approved | rejected | converted_to_order. Nota: total_amount aquí es el monto SELLADO en la fila; en cotizaciones aprobadas editables puede quedar desfasado de los ítems actuales — usa get_quotation para el total recalculado en vivo.',
      inputSchema: {
        status: z.string().optional().describe('Filtrar por estado exacto'),
        search: z.string().optional().describe('Busca en nombre de cotización y nombre del cliente'),
        ...pagination,
      },
      annotations: readOnly,
    },
    (input, extra) => run(extra, (db) => listQuotations(db, input)),
  )

  server.registerTool(
    'get_quotation',
    {
      title: 'Detalle de cotización',
      description:
        'Cotización completa con sus ítems (en orden), totales calculados (total y total de aprobados) y estado de aprobación por ítem. Obtén el id con list_quotations.',
      inputSchema: { id: z.string().describe('UUID de la cotización') },
      annotations: readOnly,
    },
    ({ id }, extra) => run(extra, (db) => getQuotation(db, id)),
  )

  server.registerTool(
    'get_quotation_stats',
    {
      title: 'Métricas de cotizaciones',
      description: 'Conteo de cotizaciones por estado (draft, sent_for_approval, approved, rejected, converted_to_order).',
      inputSchema: {},
      annotations: readOnly,
    },
    (_input, extra) => run(extra, (db) => getQuotationStats(db)),
  )

  server.registerTool(
    'list_orders',
    {
      title: 'Listar órdenes',
      description:
        'Lista órdenes de compra con filtros. status: ordered | received | delivered | completed | cancelled. Úsala para "¿qué órdenes siguen abiertas?" o buscar por cliente. Nota: total_amount aquí es el monto SELLADO en la fila; usa get_order para el total recalculado en vivo desde los ítems.',
      inputSchema: {
        status: z.string().optional().describe('Filtrar por estado exacto'),
        search: z.string().optional().describe('Busca en nombre de orden y nombre del cliente'),
        ...pagination,
      },
      annotations: readOnly,
    },
    (input, extra) => run(extra, (db) => listOrders(db, input)),
  )

  server.registerTool(
    'get_order',
    {
      title: 'Detalle de orden',
      description:
        'Orden completa con sus ítems: cantidades (aprobada/en stock/por pedir/recibida), urrea_status por ítem, ubicación en tienda y cuántos ítems siguen pendientes con URREA.',
      inputSchema: { id: z.string().describe('UUID de la orden') },
      annotations: readOnly,
    },
    ({ id }, extra) => run(extra, (db) => getOrder(db, id)),
  )

  server.registerTool(
    'get_order_by_quotation',
    {
      title: 'Orden de una cotización',
      description: 'Encuentra la orden vinculada a una cotización convertida (id, nombre y estado), o indica que no existe.',
      inputSchema: { quotation_id: z.string().describe('UUID de la cotización') },
      annotations: readOnly,
    },
    ({ quotation_id }, extra) => run(extra, (db) => getOrderByQuotation(db, quotation_id)),
  )

  server.registerTool(
    'get_cut_plan',
    {
      title: 'Lista de corte de una orden',
      description:
        'Piezas de tubo y placa que se mandan a hacer para una orden (módulo de corte), agrupadas por diámetro/espesor con la necesidad neta (largo + margen por corte, en mm) y, por cada presentación del proveedor ya capturada, cuántas barras u hojas se necesitan. Úsala para "¿cuánto tubo necesito para la orden de X?". Acepta id o nombre parcial de la orden/cliente.',
      inputSchema: { orden: z.string().min(1).describe('UUID, nombre de la orden o nombre del cliente (parcial)') },
      annotations: readOnly,
    },
    (input, extra) => run(extra, (db) => getCutPlan(db, input)),
  )

  server.registerTool(
    'get_purchase_plan',
    {
      title: 'Planificador de compra de una orden',
      description:
        'Qué va a mayoreo (URREA, por paquetes STD) y qué a menudeo en una orden: por grupo código+marca la matemática (paquetes completos, resto, dinero parado), la recomendación al vuelo y la decisión guardada (con aviso si quedó desactualizada). "revisar" = el usuario debe decidir. Acepta id o nombre parcial de la orden/cliente.',
      inputSchema: { orden: z.string().min(1).describe('UUID, nombre de la orden o nombre del cliente (parcial)') },
      annotations: readOnly,
    },
    (input, extra) => run(extra, (db) => getPurchasePlan(db, input)),
  )

  server.registerTool(
    'search_inventory',
    {
      title: 'Buscar en inventario',
      description:
        'Stock de tienda por model_code, con ubicación física (gaveta) cuando hay existencias. stockFilter: in_stock (>5) | low_stock (1-5) | sin_stock (0) | all. Úsala para "¿tenemos el 6954? ¿dónde está?".',
      inputSchema: {
        search: z.string().optional().describe('Busca por model_code (parcial)'),
        stockFilter: z.string().optional().describe('all | in_stock | low_stock | sin_stock'),
        ...pagination,
      },
      annotations: readOnly,
    },
    (input, extra) => run(extra, (db) => searchInventory(db, input)),
  )

  server.registerTool(
    'get_inventory_stats',
    {
      title: 'Métricas de inventario',
      description: 'Salud del inventario: total de SKUs, con stock (>5), stock bajo (1-5) y sin stock.',
      inputSchema: {},
      annotations: readOnly,
    },
    (_input, extra) => run(extra, (db) => getInventoryStats(db)),
  )

  server.registerTool(
    'set_inventory_location',
    {
      title: 'Asignar ubicación en tienda',
      description:
        'Asigna o corrige la ubicación física (gaveta) de un producto YA inventariado. ESCRIBE: usa solo cuando el usuario pida registrar dónde quedó algo (p. ej. "el 6954 quedó en la gaveta B3"). Solo toca el metadato de ubicación — las cantidades de inventario NUNCA se modifican por aquí. location vacío o ausente = borrar la ubicación.',
      inputSchema: {
        model_code: z.string().min(1).describe('Código del producto en inventario (match exacto, sin distinguir mayúsculas/minúsculas)'),
        location: z.string().optional().describe('Ubicación física/gaveta, texto libre; omite o vacío para borrarla'),
      },
      // Scoped write (#72, ADR-015): durable metadata, not transactional.
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    (input, extra) => run(extra, (db) => setInventoryLocation(db, input)),
  )

  server.registerTool(
    'search_products',
    {
      title: 'Buscar productos ETM',
      description:
        'Busca en el catálogo ETM por código ETM, model_code o descripción. Devuelve precio, marca, is_sold (null=sin definir, false=no lo vendemos) y la Descripción DYMMSA ya resuelta con la jerarquía de catálogo.',
      inputSchema: {
        query: z.string().describe('Texto a buscar (ETM, model_code o descripción)'),
        ...pagination,
      },
      annotations: readOnly,
    },
    (input, extra) => run(extra, (db) => searchProducts(db, input)),
  )

  server.registerTool(
    'search_urrea_catalog',
    {
      title: 'Consultar catálogo URREA',
      description:
        'Consulta el catálogo oficial URREA por código (match exacto, normalizado) o por descripción (parcial, máx 20). Devuelve código, descripción oficial y std (unidades por paquete).',
      inputSchema: { query: z.string().describe('Código URREA o texto de la descripción') },
      annotations: readOnly,
    },
    ({ query }, extra) => run(extra, (db) => searchUrreaCatalog(db, query)),
  )

  server.registerTool(
    'list_suppliers',
    {
      title: 'Proveedores de menudeo',
      description:
        'Proveedores locales con contacto, plazo de pago (días de crédito; "Contado" si no hay) y las marcas que surten. Filtra por texto (nombre/teléfono/email) o por marca. Úsala para "¿quién me surte SURTEK?" o "¿qué plazo da Perfiles?".',
      inputSchema: {
        buscar: z.string().optional().describe('Texto a buscar en nombre, teléfono, whatsapp o email'),
        marca: z.string().optional().describe('Marca que debe surtir, p. ej. "SURTEK"'),
        limit: z.number().int().min(1).max(100).optional().describe('Máx proveedores (default 50)'),
      },
      annotations: readOnly,
    },
    (input, extra) => run(extra, (db) => listSuppliers(db, input)),
  )

  server.registerTool(
    'list_payables',
    {
      title: 'Facturas por pagar',
      description:
        'Facturas de GASTOS de la app (registro propio; Odoo solo factura a clientes) con proveedor, monto, vencimiento y días para vencer (negativo = vencida). Filtra por estado (pending | paid | cancelled), mes de VENCIMIENTO (YYYY-MM), proveedor (nombre parcial) o concepto. Ordenadas por vencimiento.',
      inputSchema: {
        estado: z.string().optional().describe('pending | paid | cancelled'),
        mes: z.string().optional().describe('Mes de vencimiento, YYYY-MM'),
        proveedor: z.string().optional().describe('Nombre (o parte) del proveedor'),
        concepto: z.string().optional().describe('Texto del concepto (parcial)'),
        limit: z.number().int().min(1).max(100).optional().describe('Máx facturas (default 50)'),
      },
      annotations: readOnly,
    },
    (input, extra) => run(extra, (db) => listPayables(db, input)),
  )

  server.registerTool(
    'get_payable',
    {
      title: 'Detalle de factura por pagar',
      description:
        'Una factura de gasto completa: proveedor y su plazo, concepto, monto, fechas, estado y notas. Acepta id, o parte del concepto o del nombre del proveedor; con varias coincidencias devuelve la lista.',
      inputSchema: { factura: z.string().min(1).describe('UUID, o parte del concepto / nombre del proveedor') },
      annotations: readOnly,
    },
    ({ factura }, extra) => run(extra, (db, ctx) => getPayable(db, ctx.userId, factura)),
  )

  server.registerTool(
    'get_payables_overview',
    {
      title: 'Resumen de facturas por pagar del mes',
      description:
        'Responde "¿qué debo esta semana / este mes?": pendiente del mes por semana de vencimiento, vencido (incluye el arrastre de meses anteriores), por vencer en 7 días, pagado en el mes, y las próximas 15 facturas pendientes. mes = YYYY-MM (default: el actual).',
      inputSchema: { mes: z.string().optional().describe('Mes, YYYY-MM (default actual)') },
      annotations: readOnly,
    },
    (input, extra) => run(extra, (db) => getPayablesOverview(db, input)),
  )

  server.registerTool(
    'mark_payable_paid',
    {
      title: 'Marcar factura pagada',
      description:
        'Marca una factura de gasto como PAGADA con su fecha real de pago (default hoy), o la regresa a pendiente (pagada=false). ESCRIBE: usa solo cuando el usuario lo pida ("ya pagué la de Perfiles"); confirma antes cuál factura y con qué fecha. Identifica la factura por id, concepto o proveedor (prefiere las pendientes al marcar pagada); con varias coincidencias devuelve la lista para precisar. Si ya estaba pagada, solo cambia la fecha cuando se indica fecha_pago.',
      inputSchema: {
        factura: z.string().min(1).describe('UUID, o parte del concepto / nombre del proveedor'),
        pagada: z.boolean().optional().describe('true = marcar pagada (default); false = regresar a pendiente'),
        fecha_pago: z.string().optional().describe('Fecha REAL de pago, YYYY-MM-DD (default hoy)'),
      },
      // Scoped write (#109, ADR-030): a symbolic expense record, not money nor inventory.
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    (input, extra) => run(extra, (db) => markPayablePaid(db, input)),
  )

  server.registerTool(
    'create_payable',
    {
      title: 'Registrar factura por pagar',
      description:
        'Registra una factura de GASTO como pendiente: proveedor (nombre parcial, debe existir en Proveedores), concepto, monto, fecha de factura y vencimiento opcional — sin él se calcula con los días de crédito del proveedor, como en la app. ESCRIBE: usa solo cuando el usuario pida registrar una factura; confirma los datos antes. Con varios proveedores coincidentes devuelve la lista para precisar.',
      inputSchema: {
        proveedor: z.string().min(1).describe('Nombre (o parte) del proveedor'),
        concepto: z.string().min(1).describe('Concepto de la factura'),
        monto: z.number().positive().describe('Monto en MXN, mayor a 0'),
        fecha_factura: z.string().describe('Fecha de la factura, YYYY-MM-DD'),
        vencimiento: z.string().optional().describe('Vencimiento, YYYY-MM-DD (default: fecha + plazo del proveedor)'),
        notas: z.string().optional().describe('Notas'),
      },
      // Scoped write (#109, ADR-030): always born pending; paying it is mark_payable_paid.
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    (input, extra) => run(extra, (db) => createPayable(db, input)),
  )

  server.registerTool(
    'get_month_closing',
    {
      title: 'Cierre del mes',
      description:
        'Cómo cierra un mes: egresos de la app (pagado, pendiente del mes, vencido arrastrado) + ingresos leídos de Odoo (cobrado, por cobrar, vencido por cobrar, notas de crédito aparte) y el cierre real/proyectado. Si Odoo no está disponible lo dice y el cierre refleja solo egresos. mes = YYYY-MM (default actual).',
      inputSchema: { mes: z.string().optional().describe('Mes, YYYY-MM (default actual)') },
      annotations: readOnly,
    },
    (input, extra) => run(extra, (db) => getMonthClosing(db, input)),
  )

  server.registerTool(
    'get_week_hours',
    {
      title: 'Horas de la semana',
      description:
        'Horas trabajadas de una semana según el checador, día por día, con el total y el cumplimiento de la jornada (tiempo completo 40 h / medio tiempo 20 h). Sin `persona` son las horas de quien pregunta; un administrador puede indicar a alguien por nombre parcial. `fecha` = cualquier día de la semana deseada (default: esta semana). Una "checada sin salida" no suma horas.',
      inputSchema: {
        persona: z.string().optional().describe('Nombre (o parte) de la persona; solo un administrador ve a otros'),
        fecha: z.string().optional().describe('Cualquier día de la semana, YYYY-MM-DD (default hoy)'),
      },
      annotations: readOnly,
    },
    (input, extra) => run(extra, (db, ctx) => getWeekHours(db, ctx.userId, input)),
  )

  server.registerTool(
    'get_hours_trend',
    {
      title: 'Tendencia de horas',
      description:
        'Total de horas por semana de las últimas N semanas (default 8, máx 26) hasta la actual, con el promedio semanal y el cumplimiento de la jornada. Úsala para "¿cómo viene Fulano este mes?" o "¿quién no está completando su jornada?" (una llamada por persona).',
      inputSchema: {
        persona: z.string().optional().describe('Nombre (o parte) de la persona; solo un administrador ve a otros'),
        semanas: z.number().int().min(1).max(26).optional().describe('Semanas a incluir (default 8)'),
      },
      annotations: readOnly,
    },
    (input, extra) => run(extra, (db, ctx) => getHoursTrend(db, ctx.userId, input)),
  )

  server.registerTool(
    'list_time_imports',
    {
      title: 'Cargas del checador',
      description:
        'Bitácora de los reportes semanales del checador cargados a la app: periodo, archivo, checadas insertadas/actualizadas y las saltadas por edición manual. Solo un administrador ve filas.',
      inputSchema: {
        limit: z.number().int().min(1).max(50).optional().describe('Cuántas cargas listar (default 10)'),
      },
      annotations: readOnly,
    },
    (input, extra) => run(extra, (db) => listTimeImports(db, input)),
  )

  server.registerTool(
    'list_tasks',
    {
      title: 'Listar tareas',
      description:
        'Tareas del equipo (GitHub Issues del repo). state: open | closed | all (default open). priority: low | medium | high | highest. Las cerradas incluyen si se completaron o se descartaron.',
      inputSchema: {
        state: z.string().optional().describe('open | closed | all'),
        priority: z.string().optional().describe('low | medium | high | highest'),
        page: z.number().int().min(1).optional().describe('Página (30 por página)'),
      },
      annotations: readOnly,
    },
    (input, extra) => run(extra, () => listTasks(input)),
  )

  server.registerTool(
    'get_task',
    {
      title: 'Detalle de tarea',
      description: 'Una tarea con su descripción, quién la reportó, prioridad, estado y todos sus comentarios.',
      inputSchema: { number: z.number().int().min(1).describe('Número de la tarea (#N)') },
      annotations: readOnly,
    },
    ({ number }, extra) => run(extra, () => getTask(number)),
  )

  server.registerTool(
    'create_task',
    {
      title: 'Crear tarea',
      description:
        'Crea una tarea nueva (GitHub Issue del repo). ESCRIBE: usa solo cuando el usuario pida registrar una tarea/pendiente. title es obligatorio; description opcional; priority opcional (low | medium | high | highest). La tarea queda como reportada por "Asistente (MCP)". Devuelve la tarea creada con su número (#N) y URL.',
      inputSchema: {
        title: z.string().min(1).describe('Título de la tarea (obligatorio)'),
        description: z.string().optional().describe('Descripción/detalle de la tarea'),
        priority: z.string().optional().describe('low | medium | high | highest'),
      },
      // Write (ADR-015 phase 2): no readOnlyHint on purpose.
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    (input, extra) => run(extra, () => createTask(input)),
  )

  server.registerTool(
    'update_task',
    {
      title: 'Actualizar tarea',
      description:
        'Actualiza una tarea existente (GitHub Issue). ESCRIBE: usa solo cuando el usuario pida comentar, cambiar la prioridad o cerrar/reabrir una tarea. Acepta cualquier combinación de: comment (se publica atribuido a "Asistente (MCP)"), priority (low | medium | high | highest, o "none" para quitarla) y state (open | closed; al cerrar, state_reason "completed" o "not_planned" = descartada). NO edita título ni descripción — eso se hace en la app.',
      inputSchema: {
        task_number: z.number().int().min(1).describe('Número de la tarea (#N)'),
        comment: z.string().optional().describe('Comentario a publicar en la tarea'),
        priority: z.string().optional().describe('low | medium | high | highest, o "none" para quitarla'),
        state: z.string().optional().describe('open (reabrir) | closed (cerrar)'),
        state_reason: z.string().optional().describe('Solo al cerrar: completed (default) | not_planned (descartada)'),
      },
      // Scoped write (#72, ADR-015): comment/prioritize/close, never rewrite human text.
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    (input, extra) => run(extra, () => updateTask(input)),
  )

  server.registerTool(
    'get_app_settings',
    {
      title: 'Configuración de la app',
      description:
        'Parámetros que usan los planificadores: umbrales del planificador de compra (dinero parado en MXN y % parado) y margen por corte en mm. Indica cuáles están guardados y cuáles corren con el default del código.',
      inputSchema: {},
      annotations: readOnly,
    },
    (_input, extra) => run(extra, (db) => getAppSettings(db)),
  )

  // Block B — Odoo: the COMPANY's external invoicing system, read-only with the server API key.
  // Separate world from block A — never assume a row here maps to one there (ADR-025).
  const domainSchema = z
    .array(z.tuple([z.string(), z.string(), z.unknown()]))
    .optional()
    .describe('Filtros Odoo como tripletas [campo, operador, valor] con AND implícito, p. ej. [["payment_state","=","not_paid"]]')

  server.registerTool(
    'odoo_query',
    {
      title: 'Consulta genérica en Odoo',
      description:
        'Consulta Odoo (el sistema de FACTURACIÓN de la empresa, externo a DYMMSA-WEB) sobre los modelos del catálogo permitido: facturas y sus líneas, pagos, documentos CFDI/REP, contactos, ventas y sus líneas, productos, existencias, empleados (directorio) y flotilla. Úsala para preguntas que las tools curadas no cubran. Devuelve registros normalizados (máx 50). Prefiere odoo_aggregate para totales.',
      inputSchema: {
        model: z.string().describe('Modelo Odoo del catálogo, p. ej. "account.move"'),
        domain: domainSchema,
        fields: z.array(z.string()).optional().describe('Campos a devolver (subset del catálogo; omite para todos los permitidos)'),
        limit: z.number().int().min(1).max(50).optional().describe('Máx registros (default 20)'),
        order: z.string().optional().describe('Orden, p. ej. "invoice_date desc"'),
        offset: z.number().int().min(0).optional(),
      },
      annotations: readOnly,
    },
    (input, extra) => run(extra, () => odooQuery(callOdoo, input)),
  )

  server.registerTool(
    'odoo_aggregate',
    {
      title: 'Agregados en Odoo',
      description:
        'Totales y conteos agrupados calculados POR Odoo (facturación de la empresa, externo) — la forma correcta de responder "¿cuánto…?" sin traer registros: agrupa por un campo y suma/promedia métricas. Ej.: facturas por payment_state con amount_total:sum.',
      inputSchema: {
        model: z.string().describe('Modelo Odoo del catálogo'),
        domain: domainSchema,
        group_by: z.string().describe('Campo de agrupación, p. ej. "payment_state", "partner_id" o "invoice_date:month"'),
        metrics: z.array(z.string()).optional().describe('Métricas "campo:agregador" (sum|avg|min|max|count), p. ej. ["amount_total:sum"]'),
      },
      annotations: readOnly,
    },
    (input, extra) => run(extra, () => odooAggregate(callOdoo, input)),
  )

  server.registerTool(
    'odoo_overdue_invoices',
    {
      title: 'Cartera vencida (Odoo)',
      description:
        'Responde "¿quién nos debe y desde cuándo?" desde la facturación oficial (Odoo): total vencido, desglose por cliente ordenado por monto, y las facturas más vencidas con sus días de atraso. Solo facturas de cliente contabilizadas con saldo pendiente y fecha de vencimiento superada. Aparte, `notas_credito_sin_aplicar`: notas de crédito abiertas A HOY (sin corte de fecha), saldo a favor de clientes que NO se resta del vencido.',
      inputSchema: {
        limit: z.number().int().min(1).max(50).optional().describe('Cuántas facturas "más vencidas" listar (default 10)'),
      },
      annotations: readOnly,
    },
    (input, extra) => run(extra, () => odooOverdueInvoices(callOdoo, input)),
  )

  server.registerTool(
    'odoo_invoices_summary',
    {
      title: 'Resumen de facturación (Odoo)',
      description:
        'Resumen de las facturas de cliente contabilizadas en Odoo por periodo: total facturado y pendiente, agrupado por estado_pago (default), cliente o mes. Úsala para "¿cómo cerró julio?" o "facturación por cliente del año". Las notas de crédito EMITIDAS EN EL PERIODO van aparte en `notas_credito` (total, sin_aplicar; no restan del facturado) — distinto de las abiertas a hoy que da odoo_overdue_invoices.',
      inputSchema: {
        date_from: z.string().optional().describe('Desde (YYYY-MM-DD, sobre invoice_date)'),
        date_to: z.string().optional().describe('Hasta (YYYY-MM-DD)'),
        group_by: z.enum(['estado_pago', 'cliente', 'mes']).optional(),
      },
      annotations: readOnly,
    },
    (input, extra) => run(extra, () => odooInvoicesSummary(callOdoo, input)),
  )

  server.registerTool(
    'odoo_sales_summary',
    {
      title: 'Resumen de ventas (Odoo)',
      description:
        'Ventas registradas en Odoo (externo) por periodo: total y órdenes, agrupado por estado (default), cliente, vendedor o mes. Por default solo ventas CONFIRMADAS (sale/done); incluir="todas" suma las cotizaciones draft/sent de Odoo. No confundir con las cotizaciones de DYMMSA-WEB.',
      inputSchema: {
        date_from: z.string().optional().describe('Desde (YYYY-MM-DD, sobre date_order)'),
        date_to: z.string().optional().describe('Hasta (YYYY-MM-DD)'),
        group_by: z.enum(['estado', 'cliente', 'vendedor', 'mes']).optional(),
        incluir: z.enum(['confirmadas', 'todas']).optional(),
      },
      annotations: readOnly,
    },
    (input, extra) => run(extra, () => odooSalesSummary(callOdoo, input)),
  )

  server.registerTool(
    'odoo_customer_profile',
    {
      title: 'Perfil de cliente (Odoo)',
      description:
        'El expediente completo de un cliente en Odoo (externo) en una llamada: datos de contacto (incl. RFC), su CARTERA como la calcula Odoo (deuda total, vencido y días promedio que tarda en pagar — DSO), ventas por estado, facturación con pendiente de pago, sus facturas vencidas con días de atraso y sus notas de crédito abiertas a hoy (`notas_credito_sin_aplicar`: saldo a favor exacto + las últimas 10, no restado de lo pendiente). Busca por nombre parcial; si hay varias coincidencias devuelve la lista para precisar.',
      inputSchema: {
        cliente: z.string().min(1).describe('Nombre (o parte) del cliente, p. ej. "GE" o "Andritz"'),
      },
      annotations: readOnly,
    },
    (input, extra) => run(extra, () => odooCustomerProfile(callOdoo, input)),
  )

  server.registerTool(
    'odoo_receivables_ranking',
    {
      title: 'Ranking de cobranza (Odoo)',
      description:
        'Responde "¿a quién le cobro primero?" y "¿quién paga más lento?" desde la facturación oficial (Odoo): todos los clientes con saldo, con la deuda total, el vencido y los días promedio de pago (DSO) que Odoo calcula por cliente. Devuelve el top por vencido (luego por deuda) y el top de los más lentos, más los totales de cartera. Úsala para la revisión semanal de cobranza; para el detalle de uno, odoo_customer_profile.',
      inputSchema: {
        limit: z.number().int().min(1).max(50).optional().describe('Cuántos clientes por lista (default 10)'),
      },
      annotations: readOnly,
    },
    (input, extra) => run(extra, () => odooReceivablesRanking(callOdoo, input)),
  )

  server.registerTool(
    'odoo_invoice_detail',
    {
      title: 'Detalle de factura (Odoo)',
      description:
        'Una factura de Odoo (externo) completa por folio (p. ej. "F00167"): encabezado con montos, saldo, término de pago real y notas al pie (p. ej. "PEDIDO: …"), el VÍNCULO con órdenes de venta (cuántas están ligadas de verdad + diagnóstico: ligada / vínculo roto / huérfana), TIMBRADO CFDI (folio fiscal/UUID, estado ante el SAT) y sus líneas con cantidad, unidad (piezas vs cajas) y si cada línea viene de una venta. Acepta folio parcial; con varias coincidencias devuelve la lista.',
      inputSchema: {
        folio: z.string().min(1).describe('Folio de la factura, p. ej. "F00167"'),
      },
      annotations: readOnly,
    },
    (input, extra) => run(extra, () => odooInvoiceDetail(callOdoo, input)),
  )

  server.registerTool(
    'odoo_sale_detail',
    {
      title: 'Detalle de venta (Odoo)',
      description:
        'Una orden de venta de Odoo (externo) completa por folio (p. ej. "S00247"): encabezado con estado y vendedor, las FACTURAS ligadas (folio, estado, pagada o no) y sus líneas con cantidades PEDIDO/ENTREGADO/FACTURADO/POR FACTURAR y unidad por producto — útil para "¿ya se entregó todo lo de la venta X?" o "¿qué falta por facturar?" (por_facturar > 0 distingue "falta facturar" de "no queda nada"). Acepta folio parcial.',
      inputSchema: {
        folio: z.string().min(1).describe('Folio de la orden de venta, p. ej. "S00247"'),
      },
      annotations: readOnly,
    },
    (input, extra) => run(extra, () => odooSaleDetail(callOdoo, input)),
  )

  server.registerTool(
    'odoo_payment_detail',
    {
      title: 'Detalle de pago con su REP (Odoo)',
      description:
        'Un pago de cliente de Odoo (externo) completo por folio (p. ej. "PAY00068"): encabezado, estado del COMPLEMENTO DE PAGO (REP) — timbrado y estado ante el SAT — y el desglose de facturas que paga, cada una con su saldo y su propio CFDI. Acepta folio parcial; con varias coincidencias devuelve la lista.',
      inputSchema: {
        folio: z.string().min(1).describe('Folio del pago, p. ej. "PAY00068"'),
      },
      annotations: readOnly,
    },
    (input, extra) => run(extra, () => odooPaymentDetail(callOdoo, input)),
  )

  server.registerTool(
    'odoo_rep_audit',
    {
      title: 'Auditoría de complementos de pago (Odoo)',
      description:
        'Barrido de pagos de cliente de Odoo (externo) en un rango de fechas, clasificados por su complemento de pago (REP): en regla, SIN REP, o con REP fallido/no válido ante el SAT. El cruce pago→REP es por las facturas conciliadas. Default: últimos 30 días. Úsala para el barrido mensual de "¿qué pagos se quedaron sin timbrar?".',
      inputSchema: {
        date_from: z.string().optional().describe('Desde (YYYY-MM-DD); default hace 30 días'),
        date_to: z.string().optional().describe('Hasta (YYYY-MM-DD); default hoy'),
      },
      annotations: readOnly,
    },
    (input, extra) => run(extra, () => odooRepAudit(callOdoo, input)),
  )

  server.registerTool(
    'odoo_invoice_link_check',
    {
      title: 'Facturas sin orden de venta (Odoo)',
      description:
        'Revisión de que cada factura de cliente contabilizada en Odoo esté ligada a su orden de venta, en una llamada: lee las facturas del periodo (default últimos 30 días; opcionalmente un cliente) y devuelve las HUÉRFANAS (sin orden ligada ni origen) y las de VÍNCULO ROTO (el origen menciona una orden pero ninguna está ligada), cada una con folio, cliente, fecha, total, origen, notas al pie ("PEDIDO: …") y término de pago. Usa el vínculo real (botón "Órdenes de venta"), no el texto del origen. Pensada para la revisión periódica.',
      inputSchema: {
        date_from: z.string().optional().describe('Desde (YYYY-MM-DD, sobre invoice_date); default hace 30 días'),
        date_to: z.string().optional().describe('Hasta (YYYY-MM-DD); default hoy'),
        cliente: z.string().optional().describe('Nombre (o parte) del cliente para acotar'),
        incluir_ligadas: z.boolean().optional().describe('true = también listar las facturas correctamente ligadas'),
      },
      annotations: readOnly,
    },
    (input, extra) => run(extra, () => odooInvoiceLinkCheck(callOdoo, input)),
  )

  server.registerTool(
    'odoo_stock_check',
    {
      title: 'Existencias en Odoo',
      description:
        'Existencias en el ALMACÉN DE ODOO (externo), buscando por nombre o código de producto y sumando todas las ubicaciones. ⚠️ NO es el inventario de la tienda de DYMMSA-WEB — para ese usa search_inventory. Son dos inventarios distintos.',
      inputSchema: {
        producto: z.string().min(1).describe('Nombre o código del producto, p. ej. "punta de cobre" o "510023782"'),
      },
      annotations: readOnly,
    },
    (input, extra) => run(extra, () => odooStockCheck(callOdoo, input)),
  )

  server.registerTool(
    'odoo_employee_directory',
    {
      title: 'Directorio de empleados (Odoo)',
      description:
        'Directorio LABORAL del equipo registrado en Odoo (externo): nombre, puesto, departamento y contacto de trabajo. No incluye — por diseño — nómina, salarios ni datos personales.',
      inputSchema: {},
      annotations: readOnly,
    },
    (_input, extra) => run(extra, () => odooEmployeeDirectory(callOdoo)),
  )

  server.registerTool(
    'odoo_fleet_status',
    {
      title: 'Estado de la flotilla (Odoo)',
      description:
        'La flotilla registrada en Odoo (externo): vehículos con placas, conductor asignado, odómetro y estado, más los últimos servicios/mantenimientos de la bitácora.',
      inputSchema: {},
      annotations: readOnly,
    },
    (_input, extra) => run(extra, () => odooFleetStatus(callOdoo)),
  )

  server.registerResource(
    'reglas-negocio',
    'dymmsa://reglas-negocio',
    {
      title: 'Reglas de negocio DYMMSA',
      description: 'Reglas críticas del sistema (estados, separadores, is_sold, stock, jerarquía de descripciones). Léelas antes de interpretar datos.',
      mimeType: 'text/markdown',
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: 'text/markdown', text: BUSINESS_RULES_MD }],
    }),
  )
}
