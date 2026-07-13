/**
 * Registro de tools MCP.
 *
 * Fase 1: solo lectura sobre todos los módulos. Fase 2 (ADR-015): primera
 * escritura, acotada a crear tareas (create_task) — el resto sigue siendo
 * lectura. Cualquier escritura nueva requiere decisión explícita del usuario.
 *
 * Cada tool delega en una función pura de tools/* que recibe el admin client
 * (service role) — la autorización ya ocurrió en el route handler (auth.ts).
 */

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { createAdminClient } from '@/lib/supabase/admin'
import { GitHubError } from '@/lib/github'
import { ToolError } from './shared'
import { listQuotations, getQuotation, getQuotationStats } from './tools/quotations'
import { listOrders, getOrder, getOrderByQuotation } from './tools/orders'
import { searchInventory, getInventoryStats } from './tools/inventory'
import { searchProducts } from './tools/products'
import { searchUrreaCatalog } from './tools/urrea'
import { listTasks, getTask, createTask } from './tools/tasks'
import { getBusinessSummary } from './tools/summary'

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean }

/** Ejecuta un tool y traduce errores: esperados → mensaje; el resto → genérico. */
async function run(fn: () => Promise<unknown>): Promise<ToolResult> {
  try {
    const data = await fn()
    return { content: [{ type: 'text', text: JSON.stringify(data) }] }
  } catch (e) {
    if (e instanceof ToolError || e instanceof GitHubError) {
      return { content: [{ type: 'text', text: e.message }], isError: true }
    }
    console.error('MCP tool error:', e)
    return { content: [{ type: 'text', text: 'Error interno al ejecutar la herramienta' }], isError: true }
  }
}

const pagination = {
  page: z.number().int().min(1).optional().describe('Página (1-indexada, default 1)'),
  pageSize: z.number().int().min(1).max(100).optional().describe('Resultados por página (default 20, máx 100)'),
}

const BUSINESS_RULES_MD = `# Reglas de negocio DYMMSA (referencia para el asistente)

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
- Moneda: MXN. Cliente principal: distribuidor URREA en Morelia, México.`

export function registerDymmsaTools(server: McpServer): void {
  const db = createAdminClient()

  // ─── Resumen ─────────────────────────────────────────────────────────
  server.registerTool(
    'get_business_summary',
    {
      title: 'Resumen del negocio',
      description:
        'Panorama general de DYMMSA en una llamada: cotizaciones por estado, órdenes por estado, salud del inventario, tamaño de catálogos y tareas abiertas. Úsala primero cuando pregunten "¿cómo vamos?" o necesites contexto global.',
      inputSchema: {},
    },
    () => run(() => getBusinessSummary(db)),
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
    },
    (input) => run(() => listQuotations(db, input)),
  )

  server.registerTool(
    'get_quotation',
    {
      title: 'Detalle de cotización',
      description:
        'Cotización completa con sus ítems (en orden), totales calculados (total y total de aprobados) y estado de aprobación por ítem. Obtén el id con list_quotations.',
      inputSchema: { id: z.string().describe('UUID de la cotización') },
    },
    ({ id }) => run(() => getQuotation(db, id)),
  )

  server.registerTool(
    'get_quotation_stats',
    {
      title: 'Métricas de cotizaciones',
      description: 'Conteo de cotizaciones por estado (draft, sent_for_approval, approved, rejected, converted_to_order).',
      inputSchema: {},
    },
    () => run(() => getQuotationStats(db)),
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
    },
    (input) => run(() => listOrders(db, input)),
  )

  server.registerTool(
    'get_order',
    {
      title: 'Detalle de orden',
      description:
        'Orden completa con sus ítems: cantidades (aprobada/en stock/por pedir/recibida), urrea_status por ítem, ubicación en tienda y cuántos ítems siguen pendientes con URREA.',
      inputSchema: { id: z.string().describe('UUID de la orden') },
    },
    ({ id }) => run(() => getOrder(db, id)),
  )

  server.registerTool(
    'get_order_by_quotation',
    {
      title: 'Orden de una cotización',
      description: 'Encuentra la orden vinculada a una cotización convertida (id, nombre y estado), o indica que no existe.',
      inputSchema: { quotation_id: z.string().describe('UUID de la cotización') },
    },
    ({ quotation_id }) => run(() => getOrderByQuotation(db, quotation_id)),
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
    },
    (input) => run(() => searchInventory(db, input)),
  )

  server.registerTool(
    'get_inventory_stats',
    {
      title: 'Métricas de inventario',
      description: 'Salud del inventario: total de SKUs, con stock (>5), stock bajo (1-5) y sin stock.',
      inputSchema: {},
    },
    () => run(() => getInventoryStats(db)),
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
    },
    (input) => run(() => searchProducts(db, input)),
  )

  // ─── Catálogo URREA ──────────────────────────────────────────────────
  server.registerTool(
    'search_urrea_catalog',
    {
      title: 'Consultar catálogo URREA',
      description:
        'Consulta el catálogo oficial URREA por código (match exacto, normalizado) o por descripción (parcial, máx 20). Devuelve código, descripción oficial y std (unidades por paquete).',
      inputSchema: { query: z.string().describe('Código URREA o texto de la descripción') },
    },
    ({ query }) => run(() => searchUrreaCatalog(db, query)),
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
    },
    (input) => run(() => listTasks(input)),
  )

  server.registerTool(
    'get_task',
    {
      title: 'Detalle de tarea',
      description: 'Una tarea con su descripción, quién la reportó, prioridad, estado y todos sus comentarios.',
      inputSchema: { number: z.number().int().min(1).describe('Número de la tarea (#N)') },
    },
    ({ number }) => run(() => getTask(number)),
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
    },
    (input) => run(() => createTask(input)),
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
