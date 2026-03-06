'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2 } from 'lucide-react'
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
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { QuotationStatusBadge } from './QuotationStatusBadge'
import { useDeleteQuotation } from '@/hooks/useQuotations'
import type { Quotation } from '@/types/database'

interface QuotationsTableProps {
  quotations: Quotation[]
  isLoading: boolean
}

export function QuotationsTable({ quotations, isLoading }: QuotationsTableProps) {
  const router = useRouter()
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const deleteQuotation = useDeleteQuotation()

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
          <TableHeader>
            <TableRow>
              <TableHead>ID</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>Fecha</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {[...Array(5)].map((_, i) => (
              <TableRow key={i}>
                <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                <TableCell><Skeleton className="h-4 w-40" /></TableCell>
                <TableCell><Skeleton className="h-6 w-28" /></TableCell>
                <TableCell><Skeleton className="h-4 w-20 ml-auto" /></TableCell>
                <TableCell><Skeleton className="h-4 w-24" /></TableCell>
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
      <div className="rounded-md border p-12 text-center text-muted-foreground">
        <p className="text-sm">No hay cotizaciones registradas.</p>
      </div>
    )
  }

  return (
    <>
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>ID</TableHead>
            <TableHead>Cliente</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead className="text-right">Total</TableHead>
            <TableHead>Fecha</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {quotations.map((q) => (
            <TableRow
              key={q.id}
              className="cursor-pointer hover:bg-muted/50"
              onClick={() => router.push(`/dashboard/quotations/${q.id}`)}
            >
              <TableCell className="font-mono text-xs text-muted-foreground">
                {q.id.slice(0, 8)}…
              </TableCell>
              <TableCell className="font-medium">{q.customer_name}</TableCell>
              <TableCell>
                <QuotationStatusBadge status={q.status} />
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {q.total_amount > 0
                  ? `$${q.total_amount.toLocaleString('es-MX', { minimumFractionDigits: 2 })}`
                  : <span className="text-muted-foreground text-sm">Sin precio</span>
                }
              </TableCell>
              <TableCell className="text-muted-foreground text-sm">
                {new Date(q.created_at).toLocaleDateString('es-MX', {
                  day:   '2-digit',
                  month: 'short',
                  year:  'numeric',
                })}
              </TableCell>
              <TableCell onClick={(e) => e.stopPropagation()}>
                {q.status !== 'converted_to_order' && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => setDeletingId(q.id)}
                    title="Eliminar cotización"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>

    <AlertDialog open={!!deletingId} onOpenChange={(o) => { if (!o) setDeletingId(null) }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Eliminar esta cotización?</AlertDialogTitle>
          <AlertDialogDescription>
            Se eliminará la cotización y todos sus productos. Esta acción no se puede deshacer.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground"
            onClick={handleDelete}
            disabled={deleteQuotation.isPending}
          >
            Sí, eliminar
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  )
}
