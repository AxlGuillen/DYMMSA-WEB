'use client'

import { useState } from 'react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  MoreHorizontal,
  Pencil,
  Trash2,
  Truck,
  Plus,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
} from '@/components/icons'
import { useDeleteSupplier, type SupplierSortField } from '@/hooks/useSuppliers'
import { useVisibleColumns, type TableColumn } from '@/hooks/useVisibleColumns'
import { toast } from 'sonner'
import { formatRelative, formatAbsolute } from '@/lib/format'
import type { SupplierWithBrands } from '@/types/database'

type SortDir = 'asc' | 'desc'

interface SuppliersTableProps {
  suppliers: SupplierWithBrands[]
  isLoading: boolean
  onEdit: (supplier: SupplierWithBrands) => void
  onAdd?: () => void
  sortField: SupplierSortField
  sortDir: SortDir
  onSort: (field: SupplierSortField) => void
}

// Columnas de proveedores (issue #18). Nombre y acciones son fijas.
export const SUPPLIERS_COLUMNS: readonly TableColumn[] = [
  { id: 'name', label: 'Nombre', hideable: false },
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'phone', label: 'Teléfono' },
  { id: 'email', label: 'Correo' },
  { id: 'address', label: 'Dirección' },
  { id: 'brands', label: 'Marcas' },
  { id: 'updated_at', label: 'Última actualización' },
  { id: 'actions', label: 'Acciones', hideable: false },
]

/**
 * Link de chat de WhatsApp. Los números locales de 10 dígitos se prefijan con
 * 52 (MX) — wa.me exige código de país.
 */
function waLink(whatsapp: string): string {
  const digits = whatsapp.replace(/\D/g, '')
  return `https://wa.me/${digits.length === 10 ? `52${digits}` : digits}`
}

function SortHeader({
  label, field, active, dir, onSort, className,
}: {
  label: string
  field: SupplierSortField
  active: boolean
  dir: SortDir
  onSort: (f: SupplierSortField) => void
  className?: string
}) {
  const Icon = active ? (dir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown
  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={() => onSort(field)}
        className="flex items-center gap-1.5 font-medium transition-colors hover:text-foreground"
      >
        {label}
        <Icon className={`h-3.5 w-3.5 ${active ? 'text-foreground' : 'text-muted-foreground/50'}`} />
      </button>
    </TableHead>
  )
}

const dash = <span className="text-muted-foreground">—</span>

export function SuppliersTable({
  suppliers, isLoading, onEdit, onAdd, sortField, sortDir, onSort,
}: SuppliersTableProps) {
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const deleteSupplier = useDeleteSupplier()
  const cols = useVisibleColumns('suppliers', SUPPLIERS_COLUMNS)

  const handleDelete = async () => {
    if (!deleteId) return
    try {
      await deleteSupplier.mutateAsync(deleteId)
      toast.success('Proveedor eliminado')
    } catch {
      toast.error('Error al eliminar el proveedor')
    } finally {
      setDeleteId(null)
    }
  }

  const tableHeaders = (
    <TableHeader>
      <TableRow>
        <SortHeader label="Nombre" field="name" active={sortField === 'name'} dir={sortDir} onSort={onSort} />
        {cols.isVisible('whatsapp') && <TableHead className="w-[140px]">WhatsApp</TableHead>}
        {cols.isVisible('phone') && <TableHead className="w-[130px]">Teléfono</TableHead>}
        {cols.isVisible('email') && <TableHead>Correo</TableHead>}
        {cols.isVisible('address') && <TableHead>Dirección</TableHead>}
        {cols.isVisible('brands') && <TableHead>Marcas</TableHead>}
        {cols.isVisible('updated_at') && (
          <SortHeader label="Última actualización" field="updated_at" active={sortField === 'updated_at'} dir={sortDir} onSort={onSort} className="w-[160px]" />
        )}
        <TableHead className="w-[80px]">Acciones</TableHead>
      </TableRow>
    </TableHeader>
  )

  if (isLoading) {
    return (
      <div className="rounded-md border">
        <Table>
          {tableHeaders}
          <TableBody>
            {Array.from({ length: 6 }).map((_, i) => (
              <TableRow key={i}>
                <TableCell><Skeleton className="h-4 w-40" /></TableCell>
                {cols.isVisible('whatsapp') && <TableCell><Skeleton className="h-4 w-24" /></TableCell>}
                {cols.isVisible('phone') && <TableCell><Skeleton className="h-4 w-24" /></TableCell>}
                {cols.isVisible('email') && <TableCell><Skeleton className="h-4 w-36" /></TableCell>}
                {cols.isVisible('address') && <TableCell><Skeleton className="h-4 w-44" /></TableCell>}
                {cols.isVisible('brands') && <TableCell><Skeleton className="h-4 w-32" /></TableCell>}
                {cols.isVisible('updated_at') && <TableCell><Skeleton className="h-4 w-28" /></TableCell>}
                <TableCell><Skeleton className="size-8 rounded-md" /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    )
  }

  if (suppliers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-md border py-16 text-center">
        <Truck className="mb-4 size-12 text-muted-foreground/40" />
        <p className="font-medium text-muted-foreground">No hay proveedores registrados</p>
        <p className="mt-1 text-sm text-muted-foreground/70">
          Registra tus proveedores de menudeo y las marcas que manejan.
        </p>
        {onAdd && (
          <Button className="mt-4" onClick={onAdd}>
            <Plus className="mr-2 size-4" />
            Agregar proveedor
          </Button>
        )}
      </div>
    )
  }

  return (
    <>
      <div className="rounded-md border">
        <Table>
          {tableHeaders}
          <TableBody>
            {suppliers.map((supplier) => (
              <TableRow key={supplier.id}>
                <TableCell className="font-medium">{supplier.name}</TableCell>
                {cols.isVisible('whatsapp') && (
                  <TableCell>
                    {supplier.whatsapp ? (
                      <a
                        href={waLink(supplier.whatsapp)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="tabular-nums text-green-700 hover:underline dark:text-green-400"
                        title="Abrir chat de WhatsApp"
                      >
                        {supplier.whatsapp}
                      </a>
                    ) : dash}
                  </TableCell>
                )}
                {cols.isVisible('phone') && (
                  <TableCell className="tabular-nums">{supplier.phone || dash}</TableCell>
                )}
                {cols.isVisible('email') && (
                  <TableCell className="text-sm">{supplier.email || dash}</TableCell>
                )}
                {cols.isVisible('address') && (
                  <TableCell className="max-w-xs">
                    {supplier.address
                      ? <span className="block truncate" title={supplier.address}>{supplier.address}</span>
                      : dash}
                  </TableCell>
                )}
                {cols.isVisible('brands') && (
                  <TableCell>
                    {supplier.brands.length > 0 ? (
                      <div className="flex max-w-xs flex-wrap gap-1">
                        {supplier.brands.map((brand) => (
                          <Badge key={brand.id} variant="secondary" className="font-normal">
                            {brand.name}
                          </Badge>
                        ))}
                      </div>
                    ) : dash}
                  </TableCell>
                )}
                {cols.isVisible('updated_at') && (
                  <TableCell className="text-sm text-muted-foreground" title={formatAbsolute(supplier.updated_at)}>
                    {formatRelative(supplier.updated_at)}
                  </TableCell>
                )}
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon">
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => onEdit(supplier)}>
                        <Pencil className="mr-2 size-4" />
                        Editar
                      </DropdownMenuItem>
                      <DropdownMenuItem className="text-destructive" onClick={() => setDeleteId(supplier.id)}>
                        <Trash2 className="mr-2 size-4" />
                        Eliminar
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar proveedor</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. El proveedor y sus marcas asignadas se eliminarán
              (las marcas del catálogo no se tocan).
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
