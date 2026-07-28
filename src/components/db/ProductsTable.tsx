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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { Skeleton } from '@/components/ui/skeleton'
import { PackageSearch, ArrowUp, ArrowDown, ArrowUpDown } from '@/components/icons'
import { useDeleteProduct } from '@/hooks/useProducts'
import { useVisibleColumns, type TableColumn } from '@/hooks/useVisibleColumns'
import { useColumnWidths, RESIZABLE_TABLE_CLASS } from '@/hooks/useColumnWidths'
import { ResizableHead } from '@/components/ResizableHead'
import { RowActions } from '@/components/RowActions'
import type { ProductSortBy, SortDir } from '@/hooks/useProducts'
import { SoldStatusBadge } from '@/components/quotations/SoldStatusBadge'
import { toast } from 'sonner'
import type { EtmProduct } from '@/types/database'

// Columnas del catálogo ETM (issue #18). ETM y acciones son fijas.
// `width` = ancho por defecto; el usuario lo ajusta arrastrando (issue #55).
export const PRODUCTS_COLUMNS: readonly TableColumn[] = [
  { id: 'etm', label: 'ETM', hideable: false, width: 140 },
  { id: 'description_es', label: 'Descripcion', width: 280 },
  { id: 'description', label: 'Description', width: 260 },
  { id: 'dymmsa_description', label: 'Desc. DYMMSA', width: 260 },
  { id: 'model_code', label: 'Modelo', width: 130 },
  { id: 'brand', label: 'Marca', width: 110 },
  { id: 'price', label: 'Precio', width: 100 },
  { id: 'sold', label: 'Venta', width: 150 },
  { id: 'actions', label: 'Acciones', hideable: false, width: 100 },
]

interface ProductsTableProps {
  products: EtmProduct[]
  isLoading: boolean
  onEdit: (product: EtmProduct) => void
  sortBy?: ProductSortBy
  sortDir?: SortDir
  onSort?: (col: ProductSortBy) => void
}

/**
 * Encabezado con ancho ajustable (issue #55) y, si recibe `sortCol`, control de
 * ordenamiento. Unifica ambos casos para no repetir el cableado de la manija
 * en cada columna.
 */
function Head({
  id,
  label,
  widths,
  sortCol,
  currentSort,
  currentDir,
  onSort,
  className,
}: {
  id: string
  label: string
  widths: ReturnType<typeof useColumnWidths>
  sortCol?: ProductSortBy
  currentSort?: ProductSortBy
  currentDir?: SortDir
  onSort?: (col: ProductSortBy) => void
  className?: string
}) {
  const isActive = !!sortCol && currentSort === sortCol

  return (
    <ResizableHead id={id} label={label} widths={widths} className={className}>
      {sortCol && onSort ? (
        <button type="button"
          onClick={() => onSort(sortCol)}
          className={`flex max-w-full items-center gap-1 select-none transition-colors hover:text-foreground ${
            isActive ? 'text-foreground font-semibold' : 'text-muted-foreground'
          }`}
        >
          <span className="truncate">{label}</span>
          {isActive ? (
            currentDir === 'asc' ? (
              <ArrowUp className="size-3.5 shrink-0" />
            ) : (
              <ArrowDown className="size-3.5 shrink-0" />
            )
          ) : (
            <ArrowUpDown className="size-3.5 shrink-0 opacity-30" />
          )}
        </button>
      ) : (
        <span className="block truncate">{label}</span>
      )}
    </ResizableHead>
  )
}

export function ProductsTable({ products, isLoading, onEdit, sortBy, sortDir, onSort }: ProductsTableProps) {
  const [deleteTarget, setDeleteTarget] = useState<EtmProduct | null>(null)
  const deleteProduct = useDeleteProduct()
  const cols = useVisibleColumns('products', PRODUCTS_COLUMNS)
  const widths = useColumnWidths('products', PRODUCTS_COLUMNS)

  const sortProps = { currentSort: sortBy, currentDir: sortDir, onSort }

  // Header compartido entre skeleton / vacío / tabla real (guards una sola vez).
  const tableHeaders = (
    <TableHeader>
      <TableRow>
        <Head id="etm" label="ETM" widths={widths} sortCol="etm" {...sortProps} />
        {cols.isVisible('description_es') && (
          <Head id="description_es" label="Descripcion" widths={widths} sortCol="description_es" {...sortProps} />
        )}
        {cols.isVisible('description') && <Head id="description" label="Description" widths={widths} />}
        {cols.isVisible('dymmsa_description') && <Head id="dymmsa_description" label="Desc. DYMMSA" widths={widths} />}
        {cols.isVisible('model_code') && (
          <Head id="model_code" label="Modelo" widths={widths} sortCol="model_code" {...sortProps} />
        )}
        {cols.isVisible('brand') && <Head id="brand" label="Marca" widths={widths} />}
        {cols.isVisible('price') && (
          <Head id="price" label="Precio" widths={widths} sortCol="price" {...sortProps} />
        )}
        {cols.isVisible('sold') && <Head id="sold" label="Venta" widths={widths} className="text-center" />}
        <Head id="actions" label="Acciones" widths={widths} />
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
        <Table className={RESIZABLE_TABLE_CLASS}>
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
        <Table className={RESIZABLE_TABLE_CLASS}>
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
        <Table className={RESIZABLE_TABLE_CLASS}>
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
                  <RowActions
                    what={product.etm}
                    onEdit={() => onEdit(product)}
                    onDelete={() => setDeleteTarget(product)}
                  />
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
