/**
 * Registro de tools MCP: lectura + 3 escrituras acotadas (ADR-015), OAuth de
 * Supabase sin service_role — el db de cada llamada sale del token (ADR-023).
 */

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import { GitHubError } from '@/lib/github'
import { OdooError, callOdoo } from '@/lib/odoo/client'
import { ToolError, type Db } from './shared'
import { contextFrom } from './context'
import { odooQuery, odooAggregate, odooOverdueInvoices, odooInvoicesSummary } from './tools/odoo/accounting'
import { odooSalesSummary, odooCustomerProfile } from './tools/odoo/sales'
import { odooStockCheck, odooEmployeeDirectory, odooFleetStatus } from './tools/odoo/operations'
import { odooInvoiceDetail, odooSaleDetail } from './tools/odoo/documents'
import { odooPaymentDetail, odooRepAudit } from './tools/odoo/payments'
import { listQuotations, getQuotation, getQuotationStats } from './tools/quotations'
import { listOrders, getOrder, getOrderByQuotation } from './tools/orders'
import { searchInventory, getInventoryStats, setInventoryLocation } from './tools/inventory'
import { searchProducts } from './tools/products'
import { searchUrreaCatalog } from './tools/urrea'
import { listTasks, getTask, createTask, updateTask } from './tools/tasks'
import { getBusinessSummary } from './tools/summary'

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean }

/** El SDK entrega el AuthInfo validado por withMcpAuth en el extra de cada llamada. */
type ToolExtra = { authInfo?: AuthInfo }

/** Corre el tool con el db del token (RLS aplica); errores esperados → mensaje, resto → genérico. */
async function run(extra: ToolExtra, fn: (db: Db) => Promise<unknown>): Promise<ToolResult> {
  try {
    const { db } = contextFrom(extra.authInfo)
    const data = await fn(db)
    return { content: [{ type: 'text', text: JSON.stringify(data) }] }
  } catch (e) {
    if (e instanceof ToolError || e instanceof GitHubError || e instanceof OdooError) {
      return { content: [{ type: 'text', text: e.message }], isError: true }
    }
    console.error('MCP tool error:', e)
    return { content: [{ type: 'text', text: 'Error interno al ejecutar la herramienta' }], isError: true }
  }
}

/**
 * Lectura pura — todas las tools salvo las escrituras acotadas de ADR-015
 * (create_task, update_task, set_inventory_location).
 */
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
- **A URREA solo se piden** ítems product con brand='URREA' y quantity_to_order > 0. urrea_status: pending → supplied/not_supplied.
- **Inventario**: low_stock = 1..5 piezas; la ubicación (gaveta) solo se muestra si hay stock.
- **Cambiar el estado de una cotización regenera su approval_token** → el link de aprobación compartido antes muere.
- **Tareas** = GitHub Issues del repo; prioridad por label priority:*, "Descartada" = cerrada como not_planned.
- **Odoo (tools odoo_*)**: la facturación OFICIAL de la empresa vive en Odoo, un sistema EXTERNO a DYMMSA-WEB (solo lectura). Las cotizaciones/órdenes de aquí y las facturas de Odoo son mundos separados — no asumas cruces entre ambos.
- Moneda: MXN. Cliente principal: distribuidor URREA en Morelia, México.`

/** Instructions del server: mapa de bloques + reglas — la agrupación vive aquí, el listado es plano (#72). */
export const SERVER_INSTRUCTIONS = `# MCP DYMMSA — mapa de herramientas

Las tools se dividen en DOS bloques que NO se cruzan:

## Bloque A — DYMMSA-WEB (la app de cotizaciones e inventario)
- Panorama: get_business_summary (úsala primero para contexto global).
- Cotizaciones: list_quotations, get_quotation, get_quotation_stats.
- Órdenes: list_orders, get_order, get_order_by_quotation.
- Inventario de la TIENDA: search_inventory, get_inventory_stats; escritura acotada set_inventory_location (solo la gaveta, nunca cantidades).
- Catálogos: search_products (ETM), search_urrea_catalog (oficial URREA).
- Tareas del equipo: list_tasks, get_task; escrituras create_task y update_task (comentar/priorizar/cerrar).

## Bloque B — Odoo (prefijo odoo_*, títulos "(Odoo)")
La facturación OFICIAL de la empresa, en un sistema EXTERNO. SOLO lectura.
- Primitivas: odoo_query, odoo_aggregate (cola larga de preguntas sobre el catálogo permitido).
- Contabilidad: odoo_overdue_invoices, odoo_invoices_summary, odoo_invoice_detail, odoo_payment_detail, odoo_rep_audit.
- Ventas: odoo_sales_summary, odoo_customer_profile, odoo_sale_detail.
- Operación: odoo_stock_check (almacén de ODOO — no confundir con search_inventory, que es la tienda), odoo_employee_directory, odoo_fleet_status.

Regla de oro: los dos bloques son mundos separados — nunca asumas que una cotización de la app corresponde a una factura de Odoo. Las únicas escrituras del MCP son las tres del bloque A listadas arriba; todo lo demás es lectura.

${BUSINESS_RULES_MD}`

export function registerDymmsaTools(server: McpServer): void {
  // ═══ BLOQUE A — DYMMSA-WEB (títulos sin sufijo: la app es el default) ═══

  // ─── Resumen ─────────────────────────────────────────────────────────
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

  // ─── Cotizaciones ────────────────────────────────────────────────────
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

  // ─── Órdenes ─────────────────────────────────────────────────────────
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

  // ─── Inventario ──────────────────────────────────────────────────────
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
      // Escritura acotada (issue #72, ADR-015): metadato duradero, no transaccional.
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    (input, extra) => run(extra, (db) => setInventoryLocation(db, input)),
  )

  // ─── Catálogo ETM ────────────────────────────────────────────────────
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

  // ─── Catálogo URREA ──────────────────────────────────────────────────
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

  // ─── Tareas ──────────────────────────────────────────────────────────
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
      // Escritura (ADR-015 Fase 2): sin readOnlyHint a propósito.
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
      // Escritura acotada (issue #72, ADR-015): comentar/priorizar/cerrar, nunca reescribir texto humano.
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    (input, extra) => run(extra, () => updateTask(input)),
  )

  // ═══ BLOQUE B — ODOO (externo, SOLO lectura; mundos separados, ADR-025) ═══

  // ─── Odoo — Fase 1: Contabilidad (issue #65) ─────────────────────────
  // Consultan el Odoo de la EMPRESA (tercero donde vive la facturación
  // oficial), no la base de DYMMSA-WEB. Solo lectura, con API key del server.
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
        'Responde "¿quién nos debe y desde cuándo?" desde la facturación oficial (Odoo): total vencido, desglose por cliente ordenado por monto, y las facturas más vencidas con sus días de atraso. Solo facturas de cliente contabilizadas con saldo pendiente y fecha de vencimiento superada.',
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
        'Resumen de las facturas de cliente contabilizadas en Odoo por periodo: total facturado y pendiente, agrupado por estado_pago (default), cliente o mes. Úsala para "¿cómo cerró julio?" o "facturación por cliente del año".',
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
        'El expediente completo de un cliente en Odoo (externo) en una llamada: datos de contacto (incl. RFC), ventas por estado, facturación con pendiente de pago y sus facturas vencidas con días de atraso. Busca por nombre parcial; si hay varias coincidencias devuelve la lista para precisar.',
      inputSchema: {
        cliente: z.string().min(1).describe('Nombre (o parte) del cliente, p. ej. "GE" o "Andritz"'),
      },
      annotations: readOnly,
    },
    (input, extra) => run(extra, () => odooCustomerProfile(callOdoo, input)),
  )

  server.registerTool(
    'odoo_invoice_detail',
    {
      title: 'Detalle de factura (Odoo)',
      description:
        'Una factura de Odoo (externo) completa por folio (p. ej. "F00167"): encabezado con montos y saldo, TIMBRADO CFDI (folio fiscal/UUID, estado ante el SAT) y sus líneas de producto con cantidades y precios. Acepta folio parcial; con varias coincidencias devuelve la lista.',
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
        'Una orden de venta de Odoo (externo) completa por folio (p. ej. "S00247"): encabezado con estado y vendedor, y sus líneas con cantidades PEDIDO/ENTREGADO/FACTURADO por producto — útil para "¿ya se entregó todo lo de la venta X?". Acepta folio parcial.',
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

  // ─── Recurso: reglas de negocio ──────────────────────────────────────
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
