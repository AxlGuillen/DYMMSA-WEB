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
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { useDeleteProduct } from '@/hooks/useProducts'
import { toast } from 'sonner'
import type { EtmProduct } from '@/types/database'

interface ProductsTableProps {
  products: EtmProduct[]
  isLoading: boolean
  onEdit: (product: EtmProduct) => void
}

export function ProductsTable({ products, isLoading, onEdit }: ProductsTableProps) {
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const deleteProduct = useDeleteProduct()

  const handleDelete = async () => {
    if (!deleteId) return

    try {
      await deleteProduct.mutateAsync(deleteId)
      toast.success('Producto eliminado')
    } catch (error) {
      toast.error('Error al eliminar producto')
    } finally {
      setDeleteId(null)
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    )
  }

  if (products.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="text-muted-foreground">No se encontraron productos</p>
      </div>
    )
  }

  return (
    <>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[120px]">ETM</TableHead>
              <TableHead>Descripcion</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="w-[150px]">Modelo</TableHead>
              <TableHead className="w-[100px] text-right">Precio</TableHead>
              <TableHead className="w-[80px]">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {products.map((product) => (
              <TableRow key={product.id}>
                <TableCell className="font-mono text-sm">{product.etm}</TableCell>
                <TableCell className="max-w-[300px] truncate">
                  {product.descripcion}
                </TableCell>
                <TableCell className="max-w-[300px] truncate">
                  {product.description}
                </TableCell>
                <TableCell className="font-mono text-sm">{product.modelo}</TableCell>
                <TableCell className="text-right">
                  ${product.precio.toFixed(2)}
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => onEdit(product)}>
                        <Pencil className="mr-2 h-4 w-4" />
                        Editar
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={() => setDeleteId(product.id)}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
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
            <AlertDialogTitle>Eliminar producto</AlertDialogTitle>
            <AlertDialogDescription>
              Esta accion no se puede deshacer. El producto sera eliminado permanentemente.
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
