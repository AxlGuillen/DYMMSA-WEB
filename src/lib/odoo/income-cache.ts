/**
 * Vercel Data Cache for the Odoo reads of Finanzas (#94, ADR-027) and Clientes (#145, ADR-039): shared
 * across instances and cold starts. The ONLY file importing next/cache — swap here if the API goes.
 */

import { unstable_cache } from 'next/cache'
import { callOdoo } from './client'
import {
  fetchMonthCollections,
  fetchOpenCustomerMoves,
  type OdooCollection,
  type OdooOpenInvoice,
  type OdooRows,
} from './income'
import { fetchCustomer, fetchCustomerActivity, fetchCustomers, type OdooCustomer, type OdooCustomerActivity } from './customers'

export const INCOME_CACHE_TAG = 'finance-income'
export const CUSTOMERS_CACHE_TAG = 'odoo-customers'
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
    open: stamp(await fetchOpenCustomerMoves(callOdoo)),
  }
}

// `month` is part of the key; `today` never is — the due/overdue split happens outside.
export const cachedMonthCollections = unstable_cache(
  async (month: string): Promise<CachedRows<OdooCollection>> => stamp(await fetchMonthCollections(callOdoo, month)),
  ['finance-income', 'collections'],
  { revalidate: INCOME_REVALIDATE_SECONDS, tags: [INCOME_CACHE_TAG] },
)

// New key on purpose whenever the row shape grows: old entries would lack customerId for up to 15 min (#145).
export const cachedOpenCustomerMoves = unstable_cache(
  async (): Promise<CachedRows<OdooOpenInvoice>> => stamp(await fetchOpenCustomerMoves(callOdoo)),
  ['finance-income', 'open-moves-v2'],
  { revalidate: INCOME_REVALIDATE_SECONDS, tags: [INCOME_CACHE_TAG] },
)

export const cachedCustomers = unstable_cache(
  async (): Promise<CachedRows<OdooCustomer>> => stamp(await fetchCustomers(callOdoo)),
  ['odoo-customers', 'list'],
  { revalidate: INCOME_REVALIDATE_SECONDS, tags: [CUSTOMERS_CACHE_TAG] },
)

/** `partnerId` is part of the key: one entry per customer. */
export const cachedCustomerActivity = unstable_cache(
  async (partnerId: number): Promise<OdooCustomerActivity & { customer: OdooCustomer | null; fetchedAt: string }> => ({
    customer: await fetchCustomer(callOdoo, partnerId),
    ...(await fetchCustomerActivity(callOdoo, partnerId)),
    fetchedAt: new Date().toISOString(),
  }),
  ['odoo-customers', 'activity-v2'],
  { revalidate: INCOME_REVALIDATE_SECONDS, tags: [CUSTOMERS_CACHE_TAG] },
)
