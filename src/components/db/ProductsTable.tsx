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
import { PackageSearch, MoreHorizontal, Pencil, Trash2, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react'
import { useDeleteProduct } from '@/hooks/useProducts'
import type { ProductSortBy, SortDir } from '@/hooks/useProducts'
import { toast } from 'sonner'
import type { EtmProduct } from '@/types/database'

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
      <button
        onClick={() => onSort?.(col)}
        className={`flex items-center gap-1 select-none transition-colors hover:text-foreground ${
          isActive ? 'text-foreground font-semibold' : 'text-muted-foreground'
        }`}
      >
        {children}
        {isActive ? (
          currentDir === 'asc' ? (
            <ArrowUp className="h-3.5 w-3.5" />
          ) : (
            <ArrowDown className="h-3.5 w-3.5" />
          )
        ) : (
          <ArrowUpDown className="h-3.5 w-3.5 opacity-30" />
        )}
      </button>
    </TableHead>
  )
}

export function ProductsTable({ products, isLoading, onEdit, sortBy, sortDir, onSort }: ProductsTableProps) {
  const [deleteTarget, setDeleteTarget] = useState<EtmProduct | null>(null)
  const deleteProduct = useDeleteProduct()

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
          <TableHeader>
            <TableRow>
              <SortableHead col="etm" currentSort={sortBy} currentDir={sortDir} onSort={onSort} className="w-[120px]">ETM</SortableHead>
              <SortableHead col="description_es" currentSort={sortBy} currentDir={sortDir} onSort={onSort}>Descripcion</SortableHead>
              <TableHead>Description</TableHead>
              <SortableHead col="model_code" currentSort={sortBy} currentDir={sortDir} onSort={onSort} className="w-[150px]">Modelo</SortableHead>
              <TableHead className="w-[120px]">Marca</TableHead>
              <SortableHead col="price" currentSort={sortBy} currentDir={sortDir} onSort={onSort} className="w-[100px]">Precio</SortableHead>
              <TableHead className="w-[80px]">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: 8 }).map((_, i) => (
              <TableRow key={i}>
                <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                <TableCell><Skeleton className="h-4 w-48" /></TableCell>
                <TableCell><Skeleton className="h-4 w-40" /></TableCell>
                <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                <TableCell className="text-right"><Skeleton className="h-4 w-14 ml-auto" /></TableCell>
                <TableCell><Skeleton className="h-8 w-8 rounded-md" /></TableCell>
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
          <TableHeader>
            <TableRow>
              <SortableHead col="etm" currentSort={sortBy} currentDir={sortDir} onSort={onSort} className="w-[120px]">ETM</SortableHead>
              <SortableHead col="description_es" currentSort={sortBy} currentDir={sortDir} onSort={onSort}>Descripcion</SortableHead>
              <TableHead>Description</TableHead>
              <SortableHead col="model_code" currentSort={sortBy} currentDir={sortDir} onSort={onSort} className="w-[150px]">Modelo</SortableHead>
              <TableHead className="w-[120px]">Marca</TableHead>
              <SortableHead col="price" currentSort={sortBy} currentDir={sortDir} onSort={onSort} className="w-[100px]">Precio</SortableHead>
              <TableHead className="w-[80px]">Acciones</TableHead>
            </TableRow>
          </TableHeader>
        </Table>
        <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
          <PackageSearch className="h-10 w-10 text-muted-foreground/40" />
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
          <TableHeader>
            <TableRow>
              <SortableHead col="etm" currentSort={sortBy} currentDir={sortDir} onSort={onSort} className="w-[120px]">ETM</SortableHead>
              <SortableHead col="description_es" currentSort={sortBy} currentDir={sortDir} onSort={onSort}>Descripcion</SortableHead>
              <TableHead>Description</TableHead>
              <SortableHead col="model_code" currentSort={sortBy} currentDir={sortDir} onSort={onSort} className="w-[150px]">Modelo</SortableHead>
              <TableHead className="w-[120px]">Marca</TableHead>
              <SortableHead col="price" currentSort={sortBy} currentDir={sortDir} onSort={onSort} className="w-[100px]">Precio</SortableHead>
              <TableHead className="w-[80px]">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {products.map((product) => (
              <TableRow key={product.id} className="group">
                <TableCell className="font-mono text-sm">{product.etm}</TableCell>
                <TableCell className="max-w-[260px]">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="block truncate cursor-default">
                        {product.description_es || <span className="text-muted-foreground/50">—</span>}
                      </span>
                    </TooltipTrigger>
                    {product.description_es && (
                      <TooltipContent side="bottom" className="max-w-[320px] text-xs">
                        {product.description_es}
                      </TooltipContent>
                    )}
                  </Tooltip>
                </TableCell>
                <TableCell className="max-w-[260px]">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="block truncate cursor-default text-muted-foreground">
                        {product.description || <span className="text-muted-foreground/50">—</span>}
                      </span>
                    </TooltipTrigger>
                    {product.description && (
                      <TooltipContent side="bottom" className="max-w-[320px] text-xs">
                        {product.description}
                      </TooltipContent>
                    )}
                  </Tooltip>
                </TableCell>
                <TableCell className="font-mono text-sm">{product.model_code || '—'}</TableCell>
                <TableCell>{product.brand || '—'}</TableCell>
                <TableCell className="tabular-nums">
                  ${(product.price ?? 0).toFixed(2)}
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => onEdit(product)}>
                        <Pencil className="mr-2 h-4 w-4" />
                        Editar
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onClick={() => setDeleteTarget(product)}
                      >
                        <Trash2 className="mr-2 h-4 w-4 text-destructive" />
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
