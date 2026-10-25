/** Whole-business snapshot in one call: the starter tool, crosses every module. */

import { fetchGitHub, getGitHubConfig, isPullRequest, type GitHubIssue } from '@/lib/github'
import type { Db } from '@/lib/mcp/core/db'
import { ORDER_STATUS_TOKENS } from '@/lib/order-status'
import { QUOTATION_STATUS_TOKENS } from '@/lib/quotation-status'
import type { TokenMap } from '@/lib/tokens'
import { getInventoryStats } from './inventory'
import { getQuotationStats } from './quotations'
import type { OrderStatus } from '@/types/database'

async function countRows(db: Db, table: string): Promise<number | null> {
  const { count, error } = await db.from(table).select('*', { count: 'exact', head: true })
  return error ? null : (count ?? 0)
}

async function getOrderStats(db: Db) {
  const { data, error } = await db.from('orders').select('status')
  if (error) return null

  const stats: Record<OrderStatus, number> = {
    ordered: 0,
    received: 0,
    delivered: 0,
    completed: 0,
    cancelled: 0,
  }
  ;(data ?? []).forEach((o) => {
    const s = (o as { status: OrderStatus }).status
    if (s in stats) stats[s]++
  })
  return stats
}

/** Capped at 100 (enough as an indicator). null when GitHub is unconfigured or fails. */
async function countOpenTasks(): Promise<number | null> {
  if (!getGitHubConfig()) return null
  try {
    const issues = await fetchGitHub<GitHubIssue[]>('/issues?state=open&per_page=100')
    return issues.filter((i) => !isPullRequest(i)).length
  } catch {
    return null
  }
}

export async function getBusinessSummary(db: Db) {
  const [quotations, orders, inventory, productsCount, catalogCount, openTasks] = await Promise.all([
    getQuotationStats(db).catch(() => null),
    getOrderStats(db),
    getInventoryStats(db).catch(() => null),
    countRows(db, 'etm_products'),
    countRows(db, 'urrea_catalog'),
    countOpenTasks(),
  ])

  return {
    cotizaciones_por_estado: quotations && byToken(quotations, QUOTATION_STATUS_TOKENS),
    ordenes_por_estado: orders && byToken(orders, ORDER_STATUS_TOKENS),
    inventario: inventory,
    productos_etm: productsCount,
    catalogo_urrea: catalogCount,
    tareas_abiertas: openTasks,
  }
}

/** The counts under the assistant's tokens, in the order of the flow (#155 C6). */
function byToken<K extends string>(counts: Record<K, number>, tokens: TokenMap<K>): Record<string, number> {
  return Object.fromEntries((Object.keys(counts) as K[]).map((key) => [tokens.toToken(key), counts[key]]))
}
