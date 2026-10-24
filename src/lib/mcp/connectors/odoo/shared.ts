import { z } from 'zod'
import { callOdoo } from '@/lib/odoo/client'
import { odooWriter } from '@/lib/odoo/writer'
import type { ToolView } from '@/lib/mcp/core/define'
import { MCP_VIEWS } from '@/lib/mcp/views/generated'

/** Odoo is a third-party system others edit (ADR-041 §10): every tool of this connector is open-world. */
export const odooRead = { readOnlyHint: true, openWorldHint: true } as const

export const domainSchema = z
  .array(z.tuple([z.string(), z.string(), z.unknown()]))
  .optional()
  .describe('Filtros Odoo como tripletas [campo, operador, valor] con AND implícito, p. ej. [["payment_state","=","not_paid"]]')

/** The Odoo writes (#144, ADR-040): the read-only caller plus the closed facade, never the raw transport. */
export const odooWriteDeps = { reader: callOdoo, writer: odooWriter }

export const ODOO_QUOTATION_VIEW: ToolView = {
  uri: 'ui://dymmsa/odoo-quotation.html',
  name: 'Vista: cotización de Odoo',
  description: 'Vista previa de la cotización con botón para dar de alta los productos que faltan',
  html: () => MCP_VIEWS['odoo-quotation'].html,
}
