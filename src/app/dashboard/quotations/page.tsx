'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Plus, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { QuotationsTable } from '@/components/quotations/QuotationsTable'
import { useQuotations } from '@/hooks/useQuotations'
import type { QuotationStatus } from '@/types/database'

const STATUS_OPTIONS: { value: QuotationStatus | 'all'; label: string }[] = [
  { value: 'all',                label: 'Todos los estados' },
  { value: 'draft',              label: 'Borrador' },
  { value: 'sent_for_approval',  label: 'En aprobación' },
  { value: 'approved',           label: 'Aprobada' },
  { value: 'rejected',           label: 'Rechazada' },
  { value: 'converted_to_order', label: 'Convertida a orden' },
]

export default function QuotationsPage() {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<QuotationStatus | 'all'>('all')
  const [page, setPage]     = useState(1)

  const { data, isLoading } = useQuotations({ page, pageSize: 20, search, status })

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Cotizaciones</h1>
          <p className="text-muted-foreground">
            Gestiona las cotizaciones y envíalas a aprobación
          </p>
        </div>
        <Link href="/dashboard/quoter">
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            Nueva cotización
          </Button>
        </Link>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por cliente..."
            className="pl-10"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(1)
            }}
          />
        </div>
        <Select
          value={status}
          onValueChange={(value) => {
            setStatus(value as QuotationStatus | 'all')
            setPage(1)
          }}
        >
          <SelectTrigger className="w-full sm:w-56">
            <SelectValue placeholder="Filtrar por estado" />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <QuotationsTable
        quotations={data?.data ?? []}
        isLoading={isLoading}
      />

      {/* Pagination */}
      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Mostrando{' '}
            {(page - 1) * data.pageSize + 1}–
            {Math.min(page * data.pageSize, data.count)} de {data.count} cotizaciones
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
            >
              Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
              disabled={page === data.totalPages}
            >
              Siguiente
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
