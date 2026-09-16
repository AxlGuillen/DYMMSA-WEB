import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, badRequest, notFound, serverError } from '@/lib/api-helpers'
import { todayInMexico } from '@/lib/format'
import type { PayableStatus, PayableUpdate } from '@/types/database'

const STATUSES: PayableStatus[] = ['pending', 'paid', 'cancelled']
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

// PATCH /api/payables/[id] — sparse updates
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const body = (await request.json()) as PayableUpdate
    const updates: Record<string, unknown> = {}

    if (body.concept !== undefined) {
      const concept = typeof body.concept === 'string' ? body.concept.trim() : ''
      if (!concept) return badRequest('El concepto no puede quedar vacío')
      updates.concept = concept
    }
    if (body.amount !== undefined) {
      if (typeof body.amount !== 'number' || !Number.isFinite(body.amount) || body.amount <= 0) {
        return badRequest('El monto debe ser mayor a 0')
      }
      updates.amount = body.amount
    }
    for (const field of ['invoice_date', 'due_date'] as const) {
      if (body[field] !== undefined) {
        if (typeof body[field] !== 'string' || !ISO_DATE.test(body[field])) {
          return badRequest(`Fecha inválida en ${field}`)
        }
        updates[field] = body[field]
      }
    }
    if (body.supplier_id !== undefined) {
      if (typeof body.supplier_id !== 'string' || !body.supplier_id) {
        return badRequest('Proveedor inválido')
      }
      const { data: supplier } = await supabase
        .from('suppliers').select('id').eq('id', body.supplier_id).single()
      if (!supplier) return notFound('El proveedor no existe')
      updates.supplier_id = body.supplier_id
    }
    if (body.notes !== undefined) {
      updates.notes = typeof body.notes === 'string' ? body.notes.trim() || null : null
    }
    if (body.status !== undefined) {
      if (!STATUSES.includes(body.status as PayableStatus)) return badRequest('Estado inválido')
      updates.status = body.status
      // Payment rule: marking it paid stores the REAL date (today by default);
      // going back to pending/cancelled clears it.
      if (body.status === 'paid') {
        const paidAt = body.paid_at
        if (paidAt !== undefined && paidAt !== null && (typeof paidAt !== 'string' || !ISO_DATE.test(paidAt))) {
          return badRequest('Fecha de pago inválida')
        }
        updates.paid_at = paidAt ?? todayInMexico()
      } else {
        updates.paid_at = null
      }
    } else if (body.paid_at !== undefined) {
      // Fix the payment date of an already-paid invoice without touching the status.
      if (body.paid_at !== null && (typeof body.paid_at !== 'string' || !ISO_DATE.test(body.paid_at))) {
        return badRequest('Fecha de pago inválida')
      }
      updates.paid_at = body.paid_at
    }

    if (Object.keys(updates).length === 0) return badRequest('No hay cambios para guardar')

    const { data, error } = await supabase
      .from('payables')
      .update(updates)
      .eq('id', id)
      .select('*, supplier:suppliers(id, name, payment_terms_days)')
      .single()

    if (error || !data) {
      if (error?.code === 'PGRST116') return notFound('La factura no existe')
      console.error('Error updating payable:', error)
      return serverError('Error al actualizar la factura')
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('Payable PATCH error:', error)
    return serverError('Error al actualizar la factura')
  }
}

// DELETE /api/payables/[id]
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const { error } = await supabase.from('payables').delete().eq('id', id)

    if (error) {
      console.error('Error deleting payable:', error)
      return serverError('Error al eliminar la factura')
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Payable DELETE error:', error)
    return serverError('Error al eliminar la factura')
  }
}
