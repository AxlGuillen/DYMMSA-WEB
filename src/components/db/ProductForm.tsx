'use client'

import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { useCreateProduct, useUpdateProduct } from '@/hooks/useProducts'
import { toast } from 'sonner'
import type { EtmProduct } from '@/types/database'

const productSchema = z.object({
  etm: z.string().min(1, 'ETM es requerido'),
  description: z.string(),
  descripcion: z.string().min(1, 'Descripcion es requerida'),
  modelo: z.string().min(1, 'Modelo es requerido'),
  precio: z.number().min(0, 'Precio debe ser mayor o igual a 0'),
  marca: z.string(),
})

type ProductFormValues = z.infer<typeof productSchema>

interface ProductFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  product?: EtmProduct | null
}

export function ProductForm({ open, onOpenChange, product }: ProductFormProps) {
  const isEditing = !!product
  const createProduct = useCreateProduct()
  const updateProduct = useUpdateProduct()

  const form = useForm<ProductFormValues>({
    resolver: zodResolver(productSchema),
    defaultValues: {
      etm: '',
      description: '',
      descripcion: '',
      modelo: '',
      precio: 0,
      marca: 'URREA',
    },
  })

  // Reset form when product changes or dialog opens
  useEffect(() => {
    if (open) {
      if (product) {
        form.reset({
          etm: product.etm || '',
          description: product.description || '',
          descripcion: product.descripcion || '',
          modelo: product.modelo || '',
          precio: product.precio || 0,
          marca: product.marca || 'URREA',
        })
      } else {
        form.reset({
          etm: '',
          description: '',
          descripcion: '',
          modelo: '',
          precio: 0,
          marca: 'URREA',
        })
      }
    }
  }, [open, product, form])

  const onSubmit = async (values: ProductFormValues) => {
    try {
      if (isEditing && product) {
        await updateProduct.mutateAsync({
          id: product.id,
          updates: values,
        })
        toast.success('Producto actualizado')
      } else {
        await createProduct.mutateAsync({
          ...values,
          created_by: null,
        })
        toast.success('Producto creado')
      }
      onOpenChange(false)
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Error desconocido'
      toast.error(isEditing ? 'Error al actualizar' : 'Error al crear', {
        description: errorMessage,
      })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? 'Editar Producto' : 'Agregar Producto'}
          </DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="etm"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>ETM</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Codigo ETM"
                      {...field}
                      disabled={isEditing}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="descripcion"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Descripcion (Espanol)</FormLabel>
                  <FormControl>
                    <Input placeholder="Descripcion del producto" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description (English)</FormLabel>
                  <FormControl>
                    <Input placeholder="Product description" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="modelo"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Modelo URREA</FormLabel>
                    <FormControl>
                      <Input placeholder="Codigo modelo" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="precio"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Precio</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        {...field}
                        value={field.value}
                        onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="marca"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Marca</FormLabel>
                  <FormControl>
                    <Input placeholder="URREA" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="flex justify-end gap-2 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={createProduct.isPending || updateProduct.isPending}
              >
                {createProduct.isPending || updateProduct.isPending
                  ? 'Guardando...'
                  : isEditing
                  ? 'Actualizar'
                  : 'Crear'}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
