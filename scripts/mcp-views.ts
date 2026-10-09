/** Sources of each MCP App view and their hash; shared by the build script and the freshness test (ADR-036). */

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const VIEWS = ['time-report'] as const
export type ViewName = (typeof VIEWS)[number]

export const viewDir = (name: ViewName) => join(process.cwd(), 'src/mcp-views', name)

/** The client library ships inside the HTML: a version bump must rebuild it too. */
export function viewSourceHash(name: ViewName): string {
  const extApps = JSON.parse(readFileSync(join(process.cwd(), 'node_modules/@modelcontextprotocol/ext-apps/package.json'), 'utf8')) as { version: string }
  const hash = createHash('sha256')
  for (const file of ['main.ts', 'styles.css']) hash.update(readFileSync(join(viewDir(name), file), 'utf8').replace(/\r\n/g, '\n'))
  hash.update(extApps.version)
  return hash.digest('hex').slice(0, 16)
}
