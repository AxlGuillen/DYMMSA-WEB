'use client'

import { useRouter } from 'next/navigation'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { QuotationStatusBadge } from './QuotationStatusBadge'
import type { Quotation } from '@/types/database'

interface QuotationsTableProps {
  quotations: Quotation[]
  isLoading: boolean
}

export function QuotationsTable({ quotations, isLoading }: QuotationsTableProps) {
  const router = useRouter()

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
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>ID</TableHead>
            <TableHead>Cliente</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead className="text-right">Total</TableHead>
            <TableHead>Fecha</TableHead>
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
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
