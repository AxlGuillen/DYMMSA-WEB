'use client'

import { useState } from 'react'
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Receipt, Plus, Check, RotateCcw, ArrowUpDown, ArrowUp, ArrowDown } from '@/components/icons'
import { useDeletePayable, useUpdatePayable, type PayableSortField } from '@/hooks/usePayables'
import { useVisibleColumns, type TableColumn } from '@/hooks/useVisibleColumns'
import { useColumnWidths, RESIZABLE_TABLE_CLASS, STICKY_ACTIONS_CELL, type ColumnWidths } from '@/hooks/useColumnWidths'
import { ResizableHead } from '@/components/ResizableHead'
import { RowActions } from '@/components/RowActions'
import { useCurrency } from '@/hooks/useCurrency'
import { toast } from 'sonner'
import { todayInMexico } from '@/lib/format'
import { useDateFormat } from '@/hooks/useDateFormat'
import { daysUntilDue, PAYABLE_STATUS_LABELS } from '@/lib/payables'
import { ApiError } from '@/lib/fetch-json'
import type { PayableStatus, PayableWithSupplier } from '@/types/database'

type SortDir = 'asc' | 'desc'

interface PayablesTableProps {
  payables: PayableWithSupplier[]
  isLoading: boolean
  onEdit: (payable: PayableWithSupplier) => void
  onAdd?: () => void
  sortField: PayableSortField
  sortDir: SortDir
  onSort: (field: PayableSortField) => void
}

// Concepto and acciones are fixed columns (#84).
export const PAYABLES_COLUMNS: readonly TableColumn[] = [
  { id: 'supplier', label: 'Proveedor', width: 190 },
  { id: 'concept', label: 'Concepto', hideable: false, width: 250 },
  { id: 'amount', label: 'Monto', width: 130 },
  { id: 'invoice_date', label: 'Factura', width: 120 },
  { id: 'due_date', label: 'Vencimiento', width: 160 },
  { id: 'status', label: 'Estado', width: 120 },
  { id: 'paid_at', label: 'Pagada el', width: 120 },
  { id: 'actions', label: 'Acciones', hideable: false, width: 130 },
]

const STATUS_BADGE: Record<PayableStatus, string> = {
  pending: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  paid: 'bg-green-500/15 text-green-700 dark:text-green-400',
  cancelled: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400',
}

function SortHeader({
  label, field, active, dir, onSort, widths, className,
}: {
  label: string
  field: PayableSortField
  active: boolean
  dir: SortDir
  onSort: (f: PayableSortField) => void
  widths: ColumnWidths
  className?: string
}) {
  const Icon = active ? (dir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown
  return (
    <ResizableHead id={field} label={label} widths={widths} className={className}>
      <button
        type="button"
        onClick={() => onSort(field)}
        className="flex max-w-full items-center gap-1.5 font-medium transition-colors hover:text-foreground"
      >
        <span className="truncate">{label}</span>
        <Icon className={`h-3.5 w-3.5 shrink-0 ${active ? 'text-foreground' : 'text-muted-foreground/50'}`} />
      </button>
    </ResizableHead>
  )
}

/** Due-date tone: red overdue, amber ≤7 days; pending rows only. */
function DueDateCell({ payable, today }: { payable: PayableWithSupplier; today: string }) {
  const fmtDay = useDateFormat()
  const date = fmtDay(payable.due_date)
  if (payable.status !== 'pending') return <>{date}</>
  const days = daysUntilDue(payable.due_date, today)
  if (days < 0) {
    return (
      <span className="text-red-600 dark:text-red-400">
        {date} · vencida {-days === 1 ? 'hace 1 día' : `hace ${-days} días`}
      </span>
    )
  }
  if (days <= 7) {
    return (
      <span className="text-amber-700 dark:text-amber-400">
        {date} · {days === 0 ? 'vence hoy' : `en ${days} día${days === 1 ? '' : 's'}`}
      </span>
    )
  }
  return <>{date}</>
}

const dash = <span className="text-muted-foreground">—</span>

export function PayablesTable({
  payables, isLoading, onEdit, onAdd, sortField, sortDir, onSort,
}: PayablesTableProps) {
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const deletePayable = useDeletePayable()
  const updatePayable = useUpdatePayable()
  const fmt = useCurrency()
  const fmtDay = useDateFormat()
  const cols = useVisibleColumns('payables', PAYABLES_COLUMNS)
  const widths = useColumnWidths('payables', PAYABLES_COLUMNS)
  const today = todayInMexico()

  const handleDelete = async () => {
    if (!deleteId) return
    try {
      await deletePayable.mutateAsync(deleteId)
      toast.success('Factura eliminada')
    } catch {
      toast.error('Error al eliminar la factura')
    } finally {
      setDeleteId(null)
    }
  }

  const togglePaid = async (payable: PayableWithSupplier) => {
    const toPaid = payable.status !== 'paid'
    try {
      await updatePayable.mutateAsync({
        id: payable.id,
        updates: { status: toPaid ? 'paid' : 'pending' },
      })
      toast.success(toPaid ? 'Marcada como pagada' : 'Regresada a pendiente')
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Error al actualizar la factura')
    }
  }

  const tableHeaders = (
    <TableHeader>
      <TableRow>
        {cols.isVisible('supplier') && <ResizableHead id="supplier" label="Proveedor" widths={widths} />}
        <ResizableHead id="concept" label="Concepto" widths={widths} />
        {cols.isVisible('amount') && (
          <SortHeader label="Monto" field="amount" active={sortField === 'amount'} dir={sortDir} onSort={onSort} widths={widths} className="text-right" />
        )}
        {cols.isVisible('invoice_date') && (
          <SortHeader label="Factura" field="invoice_date" active={sortField === 'invoice_date'} dir={sortDir} onSort={onSort} widths={widths} />
        )}
        {cols.isVisible('due_date') && (
          <SortHeader label="Vencimiento" field="due_date" active={sortField === 'due_date'} dir={sortDir} onSort={onSort} widths={widths} />
        )}
        {cols.isVisible('status') && <ResizableHead id="status" label="Estado" widths={widths} />}
        {cols.isVisible('paid_at') && <ResizableHead id="paid_at" label="Pagada el" widths={widths} />}
        <ResizableHead id="actions" label="Acciones" widths={widths} className="text-center" sticky />
      </TableRow>
    </TableHeader>
  )

  if (isLoading) {
    return (
      <div className="rounded-md border overflow-x-auto">
        <Table className={RESIZABLE_TABLE_CLASS}>
          {tableHeaders}
          <TableBody>
            {Array.from({ length: 6 }).map((_, i) => (
              <TableRow key={i} className="bg-background">
                {cols.isVisible('supplier') && <TableCell><Skeleton className="h-4 w-32" /></TableCell>}
                <TableCell><Skeleton className="h-4 w-44" /></TableCell>
                {cols.isVisible('amount') && <TableCell><Skeleton className="h-4 w-20 ml-auto" /></TableCell>}
                {cols.isVisible('invoice_date') && <TableCell><Skeleton className="h-4 w-20" /></TableCell>}
                {cols.isVisible('due_date') && <TableCell><Skeleton className="h-4 w-28" /></TableCell>}
                {cols.isVisible('status') && <TableCell><Skeleton className="h-5 w-20 rounded-full" /></TableCell>}
                {cols.isVisible('paid_at') && <TableCell><Skeleton className="h-4 w-20" /></TableCell>}
                <TableCell className={STICKY_ACTIONS_CELL}><Skeleton className="size-8 rounded-md" /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    )
  }

  if (payables.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-md border py-16 text-center">
        <Receipt className="mb-4 size-12 text-muted-foreground/40" />
        <p className="font-medium text-muted-foreground">No hay facturas registradas</p>
        <p className="mt-1 text-sm text-muted-foreground/70">
          Registra los gastos por pagar para ver los vencimientos en el overview.
        </p>
        {onAdd && (
          <Button className="mt-4" onClick={onAdd}>
            <Plus className="mr-2 size-4" />
            Registrar factura
          </Button>
        )}
      </div>
    )
  }

  return (
    <>
      <div className="rounded-md border overflow-x-auto">
        <Table className={RESIZABLE_TABLE_CLASS}>
          {tableHeaders}
          <TableBody>
            {payables.map((payable) => (
              <TableRow key={payable.id} className="bg-background hover:bg-muted">
                {cols.isVisible('supplier') && (
                  <TableCell className="font-medium">{payable.supplier?.name ?? dash}</TableCell>
                )}
                <TableCell>
                  <span className="block truncate" title={payable.concept}>{payable.concept}</span>
                </TableCell>
                {cols.isVisible('amount') && (
                  <TableCell className="text-right tabular-nums">{fmt(payable.amount)}</TableCell>
                )}
                {cols.isVisible('invoice_date') && (
                  <TableCell className="text-sm whitespace-nowrap">{fmtDay(payable.invoice_date)}</TableCell>
                )}
                {cols.isVisible('due_date') && (
                  <TableCell className="text-sm whitespace-nowrap">
                    <DueDateCell payable={payable} today={today} />
                  </TableCell>
                )}
                {cols.isVisible('status') && (
                  <TableCell>
                    <Badge className={STATUS_BADGE[payable.status]}>
                      {PAYABLE_STATUS_LABELS[payable.status]}
                    </Badge>
                  </TableCell>
                )}
                {cols.isVisible('paid_at') && (
                  <TableCell className="text-sm whitespace-nowrap">
                    {payable.paid_at ? fmtDay(payable.paid_at) : dash}
                  </TableCell>
                )}
                <TableCell className={STICKY_ACTIONS_CELL}>
                  <div className="flex items-center gap-1">
                    {payable.status === 'pending' ? (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-8 text-green-600 hover:bg-green-500/10 hover:text-green-600"
                        onClick={() => togglePaid(payable)}
                        title="Marcar como pagada (hoy)"
                        aria-label="Marcar como pagada"
                      >
                        <Check className="size-4" />
                      </Button>
                    ) : payable.status === 'paid' ? (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-8 text-muted-foreground"
                        onClick={() => togglePaid(payable)}
                        title="Regresar a pendiente"
                        aria-label="Regresar a pendiente"
                      >
                        <RotateCcw className="size-4" />
                      </Button>
                    ) : (
                      <span className="block size-8" />
                    )}
                    <RowActions
                      what={payable.concept}
                      onEdit={() => onEdit(payable)}
                      onDelete={() => setDeleteId(payable.id)}
                    />
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar factura</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. La factura desaparecerá del overview.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
