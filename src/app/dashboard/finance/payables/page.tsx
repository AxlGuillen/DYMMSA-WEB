'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Plus, Search, X } from '@/components/icons'
import { ColumnPicker } from '@/components/ColumnPicker'
import { PayableForm } from '@/components/finance/PayableForm'
import { PayablesTable, PAYABLES_COLUMNS } from '@/components/finance/PayablesTable'
import { usePayables, type PayableSortField } from '@/hooks/usePayables'
import { PAYABLE_STATUS_LABELS } from '@/lib/payables'
import type { PayableStatus, PayableWithSupplier } from '@/types/database'

/** Radix no admite value="" en SelectItem — centinela para "todas". */
const ALL_STATUSES = '__all__'

export default function PayablesPage() {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<string>(ALL_STATUSES)
  const [month, setMonth] = useState('')
  const [page, setPage] = useState(1)
  const [sortField, setSortField] = useState<PayableSortField>('due_date')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editingPayable, setEditingPayable] = useState<PayableWithSupplier | null>(null)

  const { data, isLoading } = usePayables({
    page,
    search,
    status: status === ALL_STATUSES ? '' : status,
    month,
    sortField,
    sortDir,
  })

  const handleSort = (field: PayableSortField) => {
    if (field === sortField) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDir('asc')
    }
    setPage(1)
  }

  const handleEdit = (payable: PayableWithSupplier) => {
    setEditingPayable(payable)
    setIsFormOpen(true)
  }

  const handleCloseForm = (open: boolean) => {
    setIsFormOpen(open)
    if (!open) setEditingPayable(null)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Facturas por pagar</h1>
          <p className="text-muted-foreground">
            {data ? `${data.count} factura${data.count !== 1 ? 's' : ''} registrada${data.count !== 1 ? 's' : ''}` : 'Registro de gastos por pagar'}
          </p>
        </div>
        <Button onClick={() => setIsFormOpen(true)}>
          <Plus className="mr-2 size-4" />
          Registrar factura
        </Button>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por concepto..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            className="pl-10 pr-9"
          />
          {search && (
            <button
              type="button"
              onClick={() => { setSearch(''); setPage(1) }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Limpiar búsqueda"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
        <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1) }}>
          <SelectTrigger className="w-auto min-w-[150px]">
            <SelectValue placeholder="Todos los estados" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_STATUSES}>Todos los estados</SelectItem>
            {(Object.keys(PAYABLE_STATUS_LABELS) as PayableStatus[]).map((s) => (
              <SelectItem key={s} value={s}>{PAYABLE_STATUS_LABELS[s]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {/* Filtro por mes de VENCIMIENTO (vacío = todos). */}
        <Input
          type="month"
          value={month}
          onChange={(e) => { setMonth(e.target.value); setPage(1) }}
          className="w-auto"
          aria-label="Filtrar por mes de vencimiento"
        />
        <ColumnPicker tableId="payables" columns={PAYABLES_COLUMNS} />
      </div>

      <PayablesTable
        payables={data?.data ?? []}
        isLoading={isLoading}
        onEdit={handleEdit}
        onAdd={() => setIsFormOpen(true)}
        sortField={sortField}
        sortDir={sortDir}
        onSort={handleSort}
      />

      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Página {data.page} de {data.totalPages}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Anterior
            </Button>
            <Button variant="outline" size="sm" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>
              Siguiente
            </Button>
          </div>
        </div>
      )}

      <PayableForm open={isFormOpen} onOpenChange={handleCloseForm} payable={editingPayable} />
    </div>
  )
}
