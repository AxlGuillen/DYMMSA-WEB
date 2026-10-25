import type { ConnectorDefinition } from '@/lib/mcp/core/define'
import { appUrl } from '@/lib/mcp/core/env'
import { CONNECTOR_NAMES } from '@/lib/mcp/core/routes'
import type { ConnectorBudget } from '@/lib/mcp/manifest'
import { odooInstructions } from './instructions'
import { ODOO_TOOLS } from '.'

/** Caps of this connector (ADR-041), tools/list on the wire. C2: 15 tools, 20,565 on the wire, 6,333 of descriptions, 2,891 of instructions. */
export const ODOO_BUDGET: ConnectorBudget = { tools: 16, listTotal: 21_500, descriptionsTotal: 6_500, instructions: 3_000 }

/** «Odoo DYMMSA» at /api/odoo/mcp (#155 B1, ADR-041): the company's official invoicing, alone. */
export const odooConnector: ConnectorDefinition = {
  id: 'odoo',
  basePath: '/api/odoo',
  serverInfo: {
    name: 'dymmsa-odoo',
    title: CONNECTOR_NAMES.odoo,
    version: '1.0.0',
    websiteUrl: appUrl(),
    icons: [{ src: `${appUrl()}/dymmsa-logo.webp`, mimeType: 'image/webp' }],
  },
  tools: ODOO_TOOLS,
  instructions: odooInstructions,
  budget: ODOO_BUDGET,
}
