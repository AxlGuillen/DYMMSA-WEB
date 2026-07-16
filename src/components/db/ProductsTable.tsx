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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { PackageSearch, MoreHorizontal, Pencil, Trash2, ArrowUp, ArrowDown, ArrowUpDown } from '@/components/icons'
import { useDeleteProduct } from '@/hooks/useProducts'
import { useVisibleColumns, type TableColumn } from '@/hooks/useVisibleColumns'
import type { ProductSortBy, SortDir } from '@/hooks/useProducts'
import { SoldStatusBadge } from '@/components/quotations/SoldStatusBadge'
import { toast } from 'sonner'
import type { EtmProduct } from '@/types/database'

// Columnas del catálogo ETM (issue #18). ETM y acciones son fijas.
export const PRODUCTS_COLUMNS: readonly TableColumn[] = [
  { id: 'etm', label: 'ETM', hideable: false },
  { id: 'description_es', label: 'Descripcion' },
  { id: 'description', label: 'Description' },
  { id: 'dymmsa_description', label: 'Desc. DYMMSA' },
  { id: 'model_code', label: 'Modelo' },
  { id: 'brand', label: 'Marca' },
  { id: 'price', label: 'Precio' },
  { id: 'sold', label: 'Venta' },
  { id: 'actions', label: 'Acciones', hideable: false },
]

interface ProductsTableProps {
  products: EtmProduct[]
  isLoading: boolean
  onEdit: (product: EtmProduct) => void
  sortBy?: ProductSortBy
  sortDir?: SortDir
  onSort?: (col: ProductSortBy) => void
}

function SortableHead({
  col,
  currentSort,
  currentDir,
  onSort,
  children,
  className,
}: {
  col: ProductSortBy
  currentSort?: ProductSortBy
  currentDir?: SortDir
  onSort?: (col: ProductSortBy) => void
  children: React.ReactNode
  className?: string
}) {
  const isActive = currentSort === col
  return (
    <TableHead className={className}>
      <button type="button"
        onClick={() => onSort?.(col)}
        className={`flex items-center gap-1 select-none transition-colors hover:text-foreground ${
          isActive ? 'text-foreground font-semibold' : 'text-muted-foreground'
        }`}
      >
        {children}
        {isActive ? (
          currentDir === 'asc' ? (
            <ArrowUp className="size-3.5" />
          ) : (
            <ArrowDown className="size-3.5" />
          )
        ) : (
          <ArrowUpDown className="size-3.5 opacity-30" />
        )}
      </button>
    </TableHead>
  )
}

export function ProductsTable({ products, isLoading, onEdit, sortBy, sortDir, onSort }: ProductsTableProps) {
  const [deleteTarget, setDeleteTarget] = useState<EtmProduct | null>(null)
  const deleteProduct = useDeleteProduct()
  const cols = useVisibleColumns('products', PRODUCTS_COLUMNS)

  // Header compartido entre skeleton / vacío / tabla real (guards una sola vez).
  const tableHeaders = (
    <TableHeader>
      <TableRow>
        <SortableHead col="etm" currentSort={sortBy} currentDir={sortDir} onSort={onSort} className="w-[120px]">ETM</SortableHead>
        {cols.isVisible('description_es') && (
          <SortableHead col="description_es" currentSort={sortBy} currentDir={sortDir} onSort={onSort}>Descripcion</SortableHead>
        )}
        {cols.isVisible('description') && <TableHead>Description</TableHead>}
        {cols.isVisible('dymmsa_description') && <TableHead>Desc. DYMMSA</TableHead>}
        {cols.isVisible('model_code') && (
          <SortableHead col="model_code" currentSort={sortBy} currentDir={sortDir} onSort={onSort} className="w-[150px]">Modelo</SortableHead>
        )}
        {cols.isVisible('brand') && <TableHead className="w-[120px]">Marca</TableHead>}
        {cols.isVisible('price') && (
          <SortableHead col="price" currentSort={sortBy} currentDir={sortDir} onSort={onSort} className="w-[100px]">Precio</SortableHead>
        )}
        {cols.isVisible('sold') && <TableHead className="w-[120px] text-center">Venta</TableHead>}
        <TableHead className="w-[80px]">Acciones</TableHead>
      </TableRow>
    </TableHeader>
  )

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      await deleteProduct.mutateAsync(deleteTarget.id)
      toast.success('Producto eliminado')
    } catch {
      toast.error('Error al eliminar producto')
    } finally {
      setDeleteTarget(null)
    }
  }

  if (isLoading) {
    return (
      <div className="rounded-md border">
        <Table>
          {tableHeaders}
          <TableBody>
            {Array.from({ length: 8 }).map((_, i) => (
              <TableRow key={i}>
                <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                {cols.isVisible('description_es') && <TableCell><Skeleton className="h-4 w-48" /></TableCell>}
                {cols.isVisible('description') && <TableCell><Skeleton className="h-4 w-40" /></TableCell>}
                {cols.isVisible('dymmsa_description') && <TableCell><Skeleton className="h-4 w-36" /></TableCell>}
                {cols.isVisible('model_code') && <TableCell><Skeleton className="h-4 w-24" /></TableCell>}
                {cols.isVisible('brand') && <TableCell><Skeleton className="h-4 w-16" /></TableCell>}
                {cols.isVisible('price') && <TableCell className="text-right"><Skeleton className="h-4 w-14 ml-auto" /></TableCell>}
                {cols.isVisible('sold') && <TableCell><Skeleton className="h-4 w-20 mx-auto" /></TableCell>}
                <TableCell><Skeleton className="size-8 rounded-md" /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    )
  }

  if (products.length === 0) {
    return (
      <div className="rounded-md border">
        <Table>
          {tableHeaders}
        </Table>
        <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
          <PackageSearch className="size-10 text-muted-foreground/40" />
          <p className="text-sm font-medium text-muted-foreground">No se encontraron productos</p>
          <p className="text-xs text-muted-foreground/70">Intenta con otro término de búsqueda o agrega un producto nuevo.</p>
        </div>
      </div>
    )
  }

  return (
    <TooltipProvider delayDuration={400}>
      <div className="rounded-md border">
        <Table>
          {tableHeaders}
          <TableBody>
            {products.map((product) => (
              <TableRow key={product.id} className="group">
                <TableCell className="font-mono text-sm">{product.etm}</TableCell>
                {cols.isVisible('description_es') && (
                  <TableCell className="max-w-[260px]">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="block truncate cursor-default">
                          {product.description_es || <span className="text-muted-foreground/50">{'\u2014'}</span>}
                        </span>
                      </TooltipTrigger>
                      {product.description_es && (
                        <TooltipContent side="bottom" className="max-w-[320px] text-xs">
                          {product.description_es}
                        </TooltipContent>
                      )}
                    </Tooltip>
                  </TableCell>
                )}
                {cols.isVisible('description') && (
                  <TableCell className="max-w-[260px]">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="block truncate cursor-default text-muted-foreground">
                          {product.description || <span className="text-muted-foreground/50">{'\u2014'}</span>}
                        </span>
                      </TooltipTrigger>
                      {product.description && (
                        <TooltipContent side="bottom" className="max-w-[320px] text-xs">
                          {product.description}
                        </TooltipContent>
                      )}
                    </Tooltip>
                  </TableCell>
                )}
                {cols.isVisible('dymmsa_description') && (
                  <TableCell className="max-w-[260px]">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="block truncate cursor-default">
                          {product.dymmsa_description || <span className="text-muted-foreground/50">{'\u2014'}</span>}
                        </span>
                      </TooltipTrigger>
                      {product.dymmsa_description && (
                        <TooltipContent side="bottom" className="max-w-[320px] text-xs">
                          {product.dymmsa_description}
                        </TooltipContent>
                      )}
                    </Tooltip>
                  </TableCell>
                )}
                {cols.isVisible('model_code') && (
                  <TableCell className="font-mono text-sm">{product.model_code || '—'}</TableCell>
                )}
                {cols.isVisible('brand') && <TableCell>{product.brand || '—'}</TableCell>}
                {cols.isVisible('price') && (
                  <TableCell className="tabular-nums">
                    ${(product.price ?? 0).toFixed(2)}
                  </TableCell>
                )}
                {cols.isVisible('sold') && (
                  <TableCell className="text-center">
                    <SoldStatusBadge value={product.is_sold} />
                  </TableCell>
                )}
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => onEdit(product)}>
                        <Pencil className="mr-2 size-4" />
                        Editar
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onClick={() => setDeleteTarget(product)}
                      >
                        <Trash2 className="mr-2 size-4 text-destructive" />
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

      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar producto</AlertDialogTitle>
            <AlertDialogDescription>
              ¿Seguro que quieres eliminar{' '}
              <span className="font-medium text-foreground font-mono">{deleteTarget?.etm}</span>
              {deleteTarget?.description_es ? ` — ${deleteTarget.description_es}` : ''}?
              {' '}Esta acción no se puede deshacer.
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
    </TooltipProvider>
  )
}
