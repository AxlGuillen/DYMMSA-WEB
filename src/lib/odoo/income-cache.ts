/**
 * Vercel Data Cache for the income reads (#94, ADR-027): shared across instances and cold
 * starts, unlike a module Map. The ONLY file importing next/cache — swap here if the API goes.
 */

import { unstable_cache } from 'next/cache'
import { callOdoo } from './client'
import {
  fetchMonthCollections,
  fetchOpenReceivables,
  type OdooCollection,
  type OdooOpenInvoice,
  type OdooRows,
} from './income'

export const INCOME_CACHE_TAG = 'finance-income'
export const INCOME_REVALIDATE_SECONDS = 900

export interface CachedRows<T> extends OdooRows<T> {
  /** ISO timestamp of the Odoo read, for "Actualizado hace X". */
  fetchedAt: string
}

const stamp = <T>(rows: OdooRows<T>): CachedRows<T> => ({ ...rows, fetchedAt: new Date().toISOString() })

/** Raw reads, no cache: the refresh route answers with these after purging the tag. */
export async function loadIncomeFresh(month: string) {
  return {
    collections: stamp(await fetchMonthCollections(callOdoo, month)),
    open: stamp(await fetchOpenReceivables(callOdoo)),
  }
}

// `month` is part of the key; `today` never is — the due/overdue split happens outside.
export const cachedMonthCollections = unstable_cache(
  async (month: string): Promise<CachedRows<OdooCollection>> => stamp(await fetchMonthCollections(callOdoo, month)),
  ['finance-income', 'collections'],
  { revalidate: INCOME_REVALIDATE_SECONDS, tags: [INCOME_CACHE_TAG] },
)

export const cachedOpenReceivables = unstable_cache(
  async (): Promise<CachedRows<OdooOpenInvoice>> => stamp(await fetchOpenReceivables(callOdoo)),
  ['finance-income', 'open-receivables'],
  { revalidate: INCOME_REVALIDATE_SECONDS, tags: [INCOME_CACHE_TAG] },
)
