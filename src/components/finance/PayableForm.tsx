'use client'

import { useState } from 'react'
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
import { useCreatePayable, useUpdatePayable } from '@/hooks/usePayables'
import { dueDateFrom } from '@/lib/payables'
import { parseNumber, todayInMexico } from '@/lib/format'
import { ApiError } from '@/lib/fetch-json'
import type { PayableWithSupplier } from '@/types/database'

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
        {/* key: los defaults salen de props sin efectos (patrón SupplierForm). */}
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

  // El vencimiento se pre-llena (proveedor.plazo + fecha de factura) SOLO
  // mientras el usuario no lo haya editado a mano.
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
    },
  })

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
        await updatePayable.mutateAsync({ id: payable.id, updates: payload })
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
                      {s.payment_terms_days != null ? ` · ${s.payment_terms_days} días` : ' · contado'}
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
