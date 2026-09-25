'use client'

import { useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Loader2 } from '@/components/icons'
import { useSuppliers } from '@/hooks/useSuppliers'
import { useCreatePayable, useUpdatePayable, usePayableEvents } from '@/hooks/usePayables'
import { useProfile } from '@/hooks/useProfile'
import { useDateFormat } from '@/hooks/useDateFormat'
import { describeAuditEvent, dueDateFrom, paymentTermsLabel, PAYABLE_STATUS_LABELS, PAYABLE_STATUSES } from '@/lib/payables'
import { formatRelative, parseNumber, todayInMexico } from '@/lib/format'
import { ApiError } from '@/lib/fetch-json'
import type { PayableUpdate, PayableWithSupplier } from '@/types/database'

const payableSchema = z.object({
  supplier_id: z.string().min(1, 'Elige el proveedor'),
  concept: z.string().min(1, 'El concepto es requerido'),
  amount: z.string().refine((v) => {
    const n = parseNumber(v)
    return n !== null && n > 0
  }, 'Monto mayor a 0'),
  invoice_date: z.string().min(1, 'La fecha de factura es requerida'),
  due_date: z.string().min(1, 'El vencimiento es requerido'),
  notes: z.string(),
  status: z.enum(PAYABLE_STATUSES),
  paid_at: z.string(),
}).refine((v) => v.status !== 'paid' || v.paid_at.length > 0, {
  message: 'Indica la fecha de pago',
  path: ['paid_at'],
})

type PayableFormValues = z.infer<typeof payableSchema>

interface PayableFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  payable?: PayableWithSupplier | null
}

export function PayableForm({ open, onOpenChange, payable }: PayableFormProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{payable ? 'Editar factura' : 'Registrar factura por pagar'}</DialogTitle>
        </DialogHeader>
        {/* key: defaults come from props without effects (SupplierForm pattern). */}
        <PayableFormBody key={payable?.id ?? 'new'} payable={payable} onOpenChange={onOpenChange} />
      </DialogContent>
    </Dialog>
  )
}

function PayableFormBody({
  payable,
  onOpenChange,
}: {
  payable?: PayableWithSupplier | null
  onOpenChange: (open: boolean) => void
}) {
  const isEditing = !!payable
  const { data: suppliersData } = useSuppliers({ pageSize: 100 })
  const suppliers = suppliersData?.data ?? []
  const createPayable = useCreatePayable()
  const updatePayable = useUpdatePayable()
  const { isAdmin } = useProfile()

  // Due date is pre-filled from the supplier's term ONLY until the user edits it.
  const [dueTouched, setDueTouched] = useState(isEditing)

  const form = useForm<PayableFormValues>({
    resolver: zodResolver(payableSchema),
    defaultValues: {
      supplier_id: payable?.supplier_id ?? '',
      concept: payable?.concept ?? '',
      amount: payable != null ? String(payable.amount) : '',
      invoice_date: payable?.invoice_date ?? todayInMexico(),
      due_date: payable?.due_date ?? '',
      notes: payable?.notes ?? '',
      status: payable?.status ?? 'pending',
      paid_at: payable?.paid_at ?? '',
    },
  })
  // eslint-disable-next-line react-hooks/incompatible-library -- react-hook-form's watch, as in ProductForm
  const status = form.watch('status')
  // Last non-empty payment date: a paid→pending→paid slip must not replace the real date with today.
  const lastPaidAt = useRef(payable?.paid_at ?? '')

  const termsOf = (supplierId: string) =>
    suppliers.find((s) => s.id === supplierId)?.payment_terms_days ?? null

  const prefillDue = (supplierId: string, invoiceDate: string) => {
    if (dueTouched || !supplierId || !invoiceDate) return
    form.setValue('due_date', dueDateFrom(invoiceDate, termsOf(supplierId)))
  }

  const onSubmit = async (values: PayableFormValues) => {
    const payload = {
      supplier_id: values.supplier_id,
      concept: values.concept.trim(),
      amount: parseNumber(values.amount)!,
      invoice_date: values.invoice_date,
      due_date: values.due_date,
      notes: values.notes.trim() || null,
    }
    try {
      if (isEditing && payable) {
        // Status/paid_at travel only when they changed: the PATCH stamps today on a bare
        // status→paid, so sending an untouched status would re-stamp the real date.
        const paidAt = values.status === 'paid' ? values.paid_at : null
        const statusPatch: PayableUpdate =
          values.status !== payable.status ? { status: values.status, paid_at: paidAt }
          : values.status === 'paid' && paidAt !== payable.paid_at ? { paid_at: paidAt }
          : {}
        await updatePayable.mutateAsync({ id: payable.id, updates: { ...payload, ...statusPatch } })
        toast.success('Factura actualizada')
      } else {
        await createPayable.mutateAsync(payload)
        toast.success('Factura registrada')
      }
      onOpenChange(false)
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Error al guardar la factura')
    }
  }

  const isPending = createPayable.isPending || updatePayable.isPending

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="supplier_id"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Proveedor</FormLabel>
              <Select
                value={field.value}
                onValueChange={(value) => {
                  field.onChange(value)
                  prefillDue(value, form.getValues('invoice_date'))
                }}
              >
                <FormControl>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Elige un proveedor" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {suppliers.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                      {` · ${paymentTermsLabel(s.payment_terms_days)}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="concept"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Concepto</FormLabel>
              <FormControl>
                <Input placeholder="Factura A-123 · material eléctrico" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="amount"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Monto (MXN)</FormLabel>
                <FormControl>
                  <Input inputMode="decimal" placeholder="0.00" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="invoice_date"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Fecha de factura</FormLabel>
                <FormControl>
                  <Input
                    type="date"
                    {...field}
                    onChange={(e) => {
                      field.onChange(e)
                      prefillDue(form.getValues('supplier_id'), e.target.value)
                    }}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <FormField
          control={form.control}
          name="due_date"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Vencimiento</FormLabel>
              <FormControl>
                <Input
                  type="date"
                  {...field}
                  onChange={(e) => {
                    setDueTouched(true)
                    field.onChange(e)
                  }}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="notes"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Notas</FormLabel>
              <FormControl>
                <Input placeholder="Opcional" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {isEditing && (
          <div className="grid grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="status"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Estado</FormLabel>
                  <Select
                    value={field.value}
                    onValueChange={(value) => {
                      field.onChange(value)
                      // Real payment date, editable: restore the last one (or today), clear when leaving "paid".
                      if (value === 'paid') { if (!form.getValues('paid_at')) form.setValue('paid_at', lastPaidAt.current || todayInMexico()) }
                      else { lastPaidAt.current = form.getValues('paid_at') || lastPaidAt.current; form.setValue('paid_at', '') }
                    }}
                  >
                    <FormControl>
                      <SelectTrigger className="w-full" aria-label="Estado">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {PAYABLE_STATUSES.map((s) => (
                        <SelectItem key={s} value={s}>{PAYABLE_STATUS_LABELS[s]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="paid_at"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Pagada el</FormLabel>
                  <FormControl>
                    <Input type="date" disabled={status !== 'paid'} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        )}
        {isEditing && isAdmin && payable && <PayableHistory payableId={payable.id} />}
        <div className="flex justify-end gap-2 pt-4">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="submit" disabled={isPending}>
            {isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
            {isEditing ? 'Guardar cambios' : 'Registrar'}
          </Button>
        </div>
      </form>
    </Form>
  )
}

/** Audit trail of one payable. Rendered only for admins; the route answers 403 to anyone else (ADR-028). */
function PayableHistory({ payableId }: { payableId: string }) {
  const { data, isLoading, isError } = usePayableEvents(payableId, true)
  const fmtDay = useDateFormat()
  return (
    <div className="rounded-md border p-3" data-testid="payable-history">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Historial</p>
      {isLoading && <p className="text-sm text-muted-foreground">Cargando…</p>}
      {isError && <p className="text-sm text-muted-foreground">No se pudo cargar el historial.</p>}
      {data && data.length === 0 && <p className="text-sm text-muted-foreground">Sin movimientos registrados.</p>}
      {data && data.length > 0 && (
        <ul className="space-y-1 text-sm">
          {data.map((e) => (
            <li key={e.id} className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate">
                {describeAuditEvent(e, fmtDay)}
                <span className="text-muted-foreground"> · {e.actor_name ?? 'Sistema'}</span>
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">{formatRelative(e.created_at)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
