/**
 * Resumen ejecutivo del negocio en una sola llamada — el tool de arranque
 * para cualquier conversación ("¿cómo vamos?"). Cruza todos los módulos.
 */

import { fetchGitHub, getGitHubConfig, isPullRequest, type GitHubIssue } from '@/lib/github'
import { type Db } from '../shared'
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

/** Tareas abiertas (máx. 100; suficiente como indicador). null si GitHub no está configurado o falla. */
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
    quotations_by_status: quotations,
    orders_by_status: orders,
    inventory,
    products_count: productsCount,
    urrea_catalog_count: catalogCount,
    open_tasks: openTasks,
  }
}
