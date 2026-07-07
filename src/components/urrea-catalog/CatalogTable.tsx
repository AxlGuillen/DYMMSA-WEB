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
import { Skeleton } from '@/components/ui/skeleton'
import { MoreHorizontal, Pencil, Trash2, Library, Plus, ArrowUpDown, ArrowUp, ArrowDown } from '@/components/icons'
import { useDeleteCatalogItem } from '@/hooks/useUrreaCatalog'
import type { CatalogSortField, SortDir } from '@/hooks/useUrreaCatalog'
import { useCurrency } from '@/hooks/useCurrency'
import { toast } from 'sonner'
import { formatRelative, formatAbsolute } from '@/lib/format'
import type { UrreaCatalogItem } from '@/types/database'

interface CatalogTableProps {
  items: UrreaCatalogItem[]
  isLoading: boolean
  onEdit: (item: UrreaCatalogItem) => void
  onAdd?: () => void
  sortField: CatalogSortField
  sortDir: SortDir
  onSort: (field: CatalogSortField) => void
}

function SortHeader({
  label,
  field,
  active,
  dir,
  onSort,
  className,
}: {
  label: string
  field: CatalogSortField
  active: boolean
  dir: SortDir
  onSort: (f: CatalogSortField) => void
  className?: string
}) {
  const Icon = active ? (dir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown
  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={() => onSort(field)}
        className="flex items-center gap-1.5 hover:text-foreground transition-colors font-medium"
      >
        {label}
        <Icon className={`h-3.5 w-3.5 ${active ? 'text-foreground' : 'text-muted-foreground/50'}`} />
      </button>
    </TableHead>
  )
}

export function CatalogTable({ items, isLoading, onEdit, onAdd, sortField, sortDir, onSort }: CatalogTableProps) {
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const deleteItem = useDeleteCatalogItem()
  const fmt = useCurrency()

  const handleDelete = async () => {
    if (!deleteId) return
    try {
      await deleteItem.mutateAsync(deleteId)
      toast.success('Producto eliminado del catálogo')
    } catch {
      toast.error('Error al eliminar producto')
    } finally {
      setDeleteId(null)
    }
  }

  const tableHeaders = (
    <TableHeader>
      <TableRow>
        <SortHeader label="Código" field="code" active={sortField === 'code'} dir={sortDir} onSort={onSort} className="w-[160px]" />
        <SortHeader label="Descripción" field="description" active={sortField === 'description'} dir={sortDir} onSort={onSort} />
        <SortHeader label="STD" field="std" active={sortField === 'std'} dir={sortDir} onSort={onSort} className="w-[90px]" />
        <SortHeader label="Precio" field="price" active={sortField === 'price'} dir={sortDir} onSort={onSort} className="w-[130px]" />
        <TableHead className="w-[150px]">Última actualización</TableHead>
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
            {Array.from({ length: 8 }).map((_, i) => (
              <TableRow key={i}>
                <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                <TableCell><Skeleton className="h-4 w-48" /></TableCell>
                <TableCell><Skeleton className="h-4 w-8" /></TableCell>
                <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                <TableCell><Skeleton className="size-8 rounded-md" /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center rounded-md border">
        <Library className="size-12 text-muted-foreground/40 mb-4" />
        <p className="font-medium text-muted-foreground">No hay productos en el catálogo</p>
        <p className="text-sm text-muted-foreground/70 mt-1">
          Agrega productos manualmente o importa desde Excel.
        </p>
        {onAdd && (
          <Button className="mt-4" onClick={onAdd}>
            <Plus className="mr-2 size-4" />
            Agregar Producto
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
            {items.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="font-mono text-sm">{item.code}</TableCell>
                <TableCell className="max-w-md">
                  {item.description || <span className="text-muted-foreground italic text-xs">Sin descripción</span>}
                </TableCell>
                <TableCell className="tabular-nums">{item.std}</TableCell>
                <TableCell className="tabular-nums">
                  {item.price != null ? fmt(item.price) : <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell className="text-muted-foreground text-sm" title={formatAbsolute(item.updated_at)}>
                  {formatRelative(item.updated_at)}
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon">
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => onEdit(item)}>
                        <Pencil className="mr-2 size-4" />
                        Editar
                      </DropdownMenuItem>
                      <DropdownMenuItem className="text-destructive" onClick={() => setDeleteId(item.id)}>
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
            <AlertDialogTitle>Eliminar del catálogo</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. El producto será eliminado del catálogo URREA.
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
