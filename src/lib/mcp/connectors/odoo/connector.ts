import type { ConnectorDefinition } from '@/lib/mcp/core/define'
import { appUrl } from '@/lib/mcp/core/env'
import { TOOL_BUDGET } from '@/lib/mcp/manifest'
import { odooInstructions } from './instructions'
import { ODOO_TOOLS } from '.'

/** Caps of this connector (ADR-041), tools/list on the wire. B2b: 15 tools, 18,713 on the wire, 6,161 of descriptions. */
export const ODOO_BUDGET = { tools: TOOL_BUDGET.tools.odoo, listTotal: 21_500, descriptionsTotal: 6_500, instructions: 3_000 } as const

/** «Odoo DYMMSA» at /api/odoo/mcp (#155 B1, ADR-041): the company's official invoicing, alone. */
export const odooConnector: ConnectorDefinition = {
  id: 'odoo',
  basePath: '/api/odoo',
  serverInfo: {
    name: 'dymmsa-odoo',
    title: 'Odoo DYMMSA',
    version: '1.0.0',
    websiteUrl: appUrl(),
    icons: [{ src: `${appUrl()}/dymmsa-logo.webp`, mimeType: 'image/webp' }],
  },
  tools: ODOO_TOOLS,
  instructions: odooInstructions,
}
