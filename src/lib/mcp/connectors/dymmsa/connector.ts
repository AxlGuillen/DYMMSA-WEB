import type { ConnectorDefinition } from '@/lib/mcp/core/define'
import { appUrl } from '@/lib/mcp/core/env'
import { serverInstructions } from '@/lib/mcp/server'
import { ODOO_TOOLS } from '@/lib/mcp/connectors/odoo'
import { DYMMSA_TOOLS } from '.'

/** «DYMMSA-WEB» at /api/mcp. It keeps the Odoo tools until users add «Odoo DYMMSA» (#155 B1 → B3). */
export const dymmsaConnector: ConnectorDefinition = {
  id: 'dymmsa',
  basePath: '/api',
  // Claude does not draw a custom connector's icon yet (claude-ai-mcp#152): declared so it shows once it does.
  serverInfo: {
    name: 'dymmsa',
    title: 'DYMMSA',
    version: '2.2.0',
    websiteUrl: appUrl(),
    icons: [{ src: `${appUrl()}/dymmsa-logo.webp`, mimeType: 'image/webp' }],
  },
  tools: [...DYMMSA_TOOLS, ...ODOO_TOOLS],
  instructions: serverInstructions,
}
