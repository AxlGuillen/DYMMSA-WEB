'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Trash2, FileText, Loader2 } from '@/components/icons'
import { toast } from 'sonner'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { QuotationStatusBadge } from './QuotationStatusBadge'
import { useDeleteQuotation } from '@/hooks/useQuotations'
import { useCurrency } from '@/hooks/useCurrency'
import { useVisibleColumns, type TableColumn } from '@/hooks/useVisibleColumns'
import { formatRelative, formatAbsolute } from '@/lib/format'
import type { QuotationWithCount } from '@/types/database'

// Columnas de la lista (issue #18). Nombre y acciones son fijas.
export const QUOTATIONS_COLUMNS: readonly TableColumn[] = [
  { id: 'name', label: 'Nombre', hideable: false },
  { id: 'customer', label: 'Cliente' },
  { id: 'status', label: 'Estado' },
  { id: 'items_count', label: 'Ítems' },
  { id: 'total', label: 'Total' },
  { id: 'created_at', label: 'Fecha' },
  { id: 'actions', label: 'Acciones', hideable: false },
]

interface QuotationsTableProps {
  quotations: QuotationWithCount[]
  isLoading: boolean
}

export function QuotationsTable({ quotations, isLoading }: QuotationsTableProps) {
  const { push } = useRouter()
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const deleteQuotation = useDeleteQuotation()
  const fmt = useCurrency()
  const cols = useVisibleColumns('quotations-list', QUOTATIONS_COLUMNS)

  // Header compartido entre skeleton y tabla real (guards escritos una vez).
  const tableHeaders = (
    <TableHeader>
      <TableRow>
        <TableHead>Nombre</TableHead>
        {cols.isVisible('customer') && <TableHead>Cliente</TableHead>}
        {cols.isVisible('status') && <TableHead>Estado</TableHead>}
        {cols.isVisible('items_count') && <TableHead className="text-center">Ítems</TableHead>}
        {cols.isVisible('total') && <TableHead className="text-right">Total</TableHead>}
        {cols.isVisible('created_at') && <TableHead>Fecha</TableHead>}
        <TableHead />
      </TableRow>
    </TableHeader>
  )

  const handleDelete = async () => {
    if (!deletingId) return
    try {
      await deleteQuotation.mutateAsync(deletingId)
      toast.success('Cotización eliminada')
      setDeletingId(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al eliminar la cotización')
    }
  }

  if (isLoading) {
    return (
      <div className="rounded-md border">
        <Table>
          {tableHeaders}
          <TableBody>
            {[...Array(5)].map((_, i) => (
              <TableRow key={i}>
                <TableCell><Skeleton className="h-4 w-48" /></TableCell>
                {cols.isVisible('customer') && <TableCell><Skeleton className="h-4 w-36" /></TableCell>}
                {cols.isVisible('status') && <TableCell><Skeleton className="h-6 w-28" /></TableCell>}
                {cols.isVisible('items_count') && <TableCell><Skeleton className="h-4 w-8 mx-auto" /></TableCell>}
                {cols.isVisible('total') && <TableCell><Skeleton className="h-4 w-20 ml-auto" /></TableCell>}
                {cols.isVisible('created_at') && <TableCell><Skeleton className="h-4 w-24" /></TableCell>}
                <TableCell />
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    )
  }

  if (quotations.length === 0) {
    return (
      <div className="rounded-md border p-16 flex flex-col items-center gap-4 text-center">
        <div className="rounded-full bg-muted p-4">
          <FileText className="size-8 text-muted-foreground" />
        </div>
        <div>
          <p className="font-medium">No hay cotizaciones</p>
          <p className="text-sm text-muted-foreground mt-1">
            Crea una nueva cotización desde el cotizador.
          </p>
        </div>
        <Link href="/dashboard/quoter">
          <Button size="sm" className="mt-2">Nueva cotización</Button>
        </Link>
      </div>
    )
  }

  return (
    <>
      <div className="rounded-md border">
        <Table>
          {tableHeaders}
          <TableBody>
            {quotations.map((q) => (
              <TableRow
                key={q.id}
                className="group cursor-pointer hover:bg-muted/50"
                onClick={() => push(`/dashboard/quotations/${q.id}`)}
              >
                <TableCell>
                  <span className="font-medium">{q.name || <span className="text-muted-foreground italic text-xs">Sin nombre</span>}</span>
                  {q.notes && (
                    <span
                      className="ml-2 text-xs text-muted-foreground"
                      title={q.notes}
                    >
                      · nota
                    </span>
                  )}
                </TableCell>
                {cols.isVisible('customer') && (
                  <TableCell className="text-sm text-muted-foreground">{q.customer_name}</TableCell>
                )}
                {cols.isVisible('status') && (
                  <TableCell>
                    <QuotationStatusBadge status={q.status} />
                  </TableCell>
                )}
                {cols.isVisible('items_count') && (
                  <TableCell className="text-center tabular-nums text-sm text-muted-foreground">
                    {q.items_count}
                  </TableCell>
                )}
                {cols.isVisible('total') && (
                  <TableCell className="text-right tabular-nums">
                    {q.total_amount > 0
                      ? fmt(q.total_amount)
                      : <span className="text-muted-foreground text-sm">{'\u2014'}</span>
                    }
                  </TableCell>
                )}
                {cols.isVisible('created_at') && (
                  <TableCell
                    className="text-muted-foreground text-sm whitespace-nowrap"
                    title={formatAbsolute(q.created_at)}
                  >
                    {formatRelative(q.created_at)}
                  </TableCell>
                )}
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-7 text-destructive hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => setDeletingId(q.id)}
                    title="Eliminar cotización"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <AlertDialog
        open={!!deletingId}
        onOpenChange={(o) => { if (!o && !deleteQuotation.isPending) setDeletingId(null) }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar esta cotización?</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminará la cotización y todos sus productos. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteQuotation.isPending}>Cancelar</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteQuotation.isPending}
            >
              {deleteQuotation.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
              Sí, eliminar
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
