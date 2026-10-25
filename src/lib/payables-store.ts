/** Payable writes of /api/payables/[id] (#157); the rules live in payables.ts, the audit trail in the DB trigger (ADR-028). */

import type { SupabaseClient } from '@supabase/supabase-js'
import { DomainError, type DomainErrorKind } from '@/lib/domain-error'
import { isUuid } from '@/lib/text'
import { isRealDate } from '@/lib/month'
import { DEFAULT_PAYABLE_CURRENCY, isPayableCurrency, parsePayableUpdate, type ISODate } from '@/lib/payables'
import type { PayableInsert, PayableStatus, PayableWithSupplier } from '@/types/database'

export class PayableError extends DomainError {
  constructor(message: string, kind: DomainErrorKind = 'invalid') {
    super(message, kind)
    this.name = 'PayableError'
  }
}

export const PAYABLE_SELECT = '*, supplier:suppliers(id, name, payment_terms_days)'
const NOT_FOUND = 'La factura no existe'

/** POST /api/payables and save_payable (#155 C6): the supplier must exist, and it is checked BEFORE the insert (a precise 404, not an FK 23503). */
export async function createPayable(db: SupabaseClient, body: unknown): Promise<PayableWithSupplier> {
  const raw = (body ?? {}) as Partial<PayableInsert>

  const supplierId = typeof raw.supplier_id === 'string' ? raw.supplier_id : ''
  if (!supplierId) throw new PayableError('Elige el proveedor de la factura')

  const concept = typeof raw.concept === 'string' ? raw.concept.trim() : ''
  if (!concept) throw new PayableError('El concepto es obligatorio')

  const amount = typeof raw.amount === 'number' ? raw.amount : NaN
  if (!Number.isFinite(amount) || amount <= 0) throw new PayableError('El monto debe ser mayor a 0')

  const currency = raw.currency ?? DEFAULT_PAYABLE_CURRENCY
  if (!isPayableCurrency(currency)) throw new PayableError('Moneda inválida: usa MXN o USD')

  if (!isRealDate(raw.invoice_date)) throw new PayableError('Fecha de factura inválida')
  if (!isRealDate(raw.due_date)) throw new PayableError('Fecha de vencimiento inválida')

  const { data: supplier } = await db.from('suppliers').select('id').eq('id', supplierId).single()
  if (!supplier) throw new PayableError('El proveedor no existe', 'not_found')

  const payload: PayableInsert = {
    supplier_id: supplierId,
    concept,
    amount,
    currency,
    invoice_date: raw.invoice_date,
    due_date: raw.due_date,
    status: 'pending',
    paid_at: null,
    notes: typeof raw.notes === 'string' ? raw.notes.trim() || null : null,
  }

  const { data, error } = await db.from('payables').insert(payload).select(PAYABLE_SELECT).single()
  if (error || !data) {
    console.error('Error creating payable:', error)
    throw new PayableError('Error al registrar la factura', 'failed')
  }
  return data as PayableWithSupplier
}

/** Sparse update read against the row's status, so a bare `paid_at` only lands on a paid invoice (#157). */
export async function updatePayable(db: SupabaseClient, id: string, body: unknown, today: ISODate): Promise<PayableWithSupplier> {
  if (!isUuid(id)) throw new PayableError(NOT_FOUND, 'not_found')
  const { data: current, error: readError } = await db.from('payables').select('id, status').eq('id', id).maybeSingle()
  if (readError) {
    console.error('Error reading payable:', readError)
    throw new PayableError('Error al actualizar la factura', 'failed')
  }
  if (!current) throw new PayableError(NOT_FOUND, 'not_found')

  const parsed = parsePayableUpdate(body, today, (current as { status: PayableStatus }).status)
  if (!parsed.ok) throw new PayableError(parsed.error)
  const { updates } = parsed
  if (Object.keys(updates).length === 0) throw new PayableError('No hay cambios para guardar')

  if (updates.supplier_id !== undefined) {
    const { data: supplier } = isUuid(updates.supplier_id)
      ? await db.from('suppliers').select('id').eq('id', updates.supplier_id).maybeSingle()
      : { data: null }
    if (!supplier) throw new PayableError('El proveedor no existe', 'not_found')
  }

  let query = db.from('payables').update(updates).eq('id', id)
  // The date fix was checked against the status read: it must still be paid when it lands.
  if (updates.status === undefined && updates.paid_at !== undefined) query = query.eq('status', 'paid')
  const { data, error } = await query.select(PAYABLE_SELECT).maybeSingle()
  if (error) {
    console.error('Error updating payable:', error)
    throw new PayableError('Error al actualizar la factura', 'failed')
  }
  if (!data) throw new PayableError('La factura cambió mientras la editabas: recarga y vuelve a intentarlo', 'conflict')
  return data as PayableWithSupplier
}

/** Hard delete; the trigger keeps a snapshot for the admin. A missing id is a 404, not an ok (#157). */
export async function deletePayable(db: SupabaseClient, id: string): Promise<void> {
  if (!isUuid(id)) throw new PayableError(NOT_FOUND, 'not_found')
  const { data, error } = await db.from('payables').delete().eq('id', id).select('id')
  if (error) {
    console.error('Error deleting payable:', error)
    throw new PayableError('Error al eliminar la factura', 'failed')
  }
  if (!data || data.length === 0) throw new PayableError(NOT_FOUND, 'not_found')
}
