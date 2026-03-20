'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Trash2, FileText } from 'lucide-react'
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
import type { QuotationWithCount } from '@/types/database'

function formatRelative(dateStr: string): string {
  const diff  = Date.now() - new Date(dateStr).getTime()
  const mins  = Math.floor(diff / 60_000)
  const hours = Math.floor(diff / 3_600_000)
  const days  = Math.floor(diff / 86_400_000)
  if (mins  <  2) return 'hace un momento'
  if (mins  < 60) return `hace ${mins} min`
  if (hours < 24) return `hace ${hours}h`
  if (days  ===1) return 'ayer'
  if (days  <  7) return `hace ${days} días`
  if (days  < 30) return `hace ${Math.floor(days / 7)} sem`
  return new Date(dateStr).toLocaleDateString('es-MX', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

function formatAbsolute(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('es-MX', {
    day: '2-digit', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

interface QuotationsTableProps {
  quotations: QuotationWithCount[]
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
              <TableHead>Cliente</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="text-center">Ítems</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>Fecha</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {[...Array(5)].map((_, i) => (
              <TableRow key={i}>
                <TableCell><Skeleton className="h-4 w-48" /></TableCell>
                <TableCell><Skeleton className="h-6 w-28" /></TableCell>
                <TableCell><Skeleton className="h-4 w-8 mx-auto" /></TableCell>
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
      <div className="rounded-md border p-16 flex flex-col items-center gap-4 text-center">
        <div className="rounded-full bg-muted p-4">
          <FileText className="h-8 w-8 text-muted-foreground" />
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
          <TableHeader>
            <TableRow>
              <TableHead>Cliente</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="text-center">Ítems</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>Fecha</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {quotations.map((q) => (
              <TableRow
                key={q.id}
                className="group cursor-pointer hover:bg-muted/50"
                onClick={() => router.push(`/dashboard/quotations/${q.id}`)}
              >
                <TableCell>
                  <span className="font-medium">{q.customer_name}</span>
                  {q.notes && (
                    <span
                      className="ml-2 text-xs text-muted-foreground"
                      title={q.notes}
                    >
                      · nota
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <QuotationStatusBadge status={q.status} />
                </TableCell>
                <TableCell className="text-center tabular-nums text-sm text-muted-foreground">
                  {q.items_count}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {q.total_amount > 0
                    ? `$${q.total_amount.toLocaleString('es-MX', { minimumFractionDigits: 2 })}`
                    : <span className="text-muted-foreground text-sm">—</span>
                  }
                </TableCell>
                <TableCell
                  className="text-muted-foreground text-sm whitespace-nowrap"
                  title={formatAbsolute(q.created_at)}
                >
                  {formatRelative(q.created_at)}
                </TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  {q.status !== 'converted_to_order' && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-opacity"
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
