/**
 * The MCP's server code never reaches the browser (#155 A3): a 'use client' module may not import the
 * catalog, the tool definitions or the core, which pull Odoo, node:crypto and the Supabase token clients.
 */

import { test, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const SERVER_ONLY = /from '@\/lib\/mcp\/(catalog|connectors|core|server|tools)\b/

function clientModules(dir = join(process.cwd(), 'src'), out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) clientModules(full, out)
    else if (/\.(ts|tsx)$/.test(entry) && /^['"]use client['"]/m.test(readFileSync(full, 'utf8'))) out.push(full)
  }
  return out
}

test('ningún módulo de cliente importa el catálogo, las definiciones ni el núcleo del MCP', () => {
  const modules = clientModules()
  expect(modules.length).toBeGreaterThan(10)
  const offenders = modules
    .filter((file) => SERVER_ONLY.test(readFileSync(file, 'utf8')))
    .map((file) => relative(process.cwd(), file).split(sep).join('/'))
  expect(offenders).toEqual([])
})
