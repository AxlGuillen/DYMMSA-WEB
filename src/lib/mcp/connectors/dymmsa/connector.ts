import type { ConnectorDefinition } from '@/lib/mcp/core/define'
import { appUrl } from '@/lib/mcp/core/env'
import type { ConnectorBudget } from '@/lib/mcp/manifest'
import { serverInstructions } from '@/lib/mcp/server'
import { DYMMSA_TOOLS } from '.'

/** Caps of this connector (ADR-041), tools/list on the wire. C1: 36 tools, 33,957 on the wire, 12,584 of descriptions, 5,978 of instructions.
 *  The instructions cap is tight on purpose: a new line has to take another out (or raise it explicitly in its PR). */
export const DYMMSA_BUDGET: ConnectorBudget = { tools: 45, listTotal: 53_000, descriptionsTotal: 19_000, instructions: 6_000 }

/** «DYMMSA-WEB» at /api/mcp: only the app's own tools since #155 B3; Odoo is «Odoo DYMMSA». */
export const dymmsaConnector: ConnectorDefinition = {
  id: 'dymmsa',
  basePath: '/api',
  // Claude does not draw a custom connector's icon yet (claude-ai-mcp#152): declared so it shows once it does.
  serverInfo: {
    name: 'dymmsa',
    title: 'DYMMSA',
    // Major bump: B3 dropped the odoo_* tools from this endpoint.
    version: '3.0.0',
    websiteUrl: appUrl(),
    icons: [{ src: `${appUrl()}/dymmsa-logo.webp`, mimeType: 'image/webp' }],
  },
  tools: DYMMSA_TOOLS,
  instructions: serverInstructions,
  budget: DYMMSA_BUDGET,
}
