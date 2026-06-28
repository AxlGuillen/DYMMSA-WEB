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
import { useCreateCatalogItem, useUpdateCatalogItem } from '@/hooks/useUrreaCatalog'
import { toast } from 'sonner'
import type { UrreaCatalogItem } from '@/types/database'

const catalogSchema = z.object({
  code: z.string().min(1, 'El código es requerido'),
  description: z.string(),
  std: z.number().int().min(1, 'El STD debe ser al menos 1'),
  price: z.number().min(0, 'El precio no puede ser negativo').nullable(),
})

type CatalogFormValues = z.infer<typeof catalogSchema>

interface CatalogFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  item?: UrreaCatalogItem | null
}

export function CatalogForm({ open, onOpenChange, item }: CatalogFormProps) {
  const isEditing = !!item
  const createItem = useCreateCatalogItem()
  const updateItem = useUpdateCatalogItem()

  const form = useForm<CatalogFormValues>({
    resolver: zodResolver(catalogSchema),
    defaultValues: { code: '', description: '', std: 1, price: null },
  })

  useEffect(() => {
    if (open) {
      form.reset(
        item
          ? {
              code: item.code || '',
              description: item.description ?? '',
              std: item.std || 1,
              price: item.price,
            }
          : { code: '', description: '', std: 1, price: null }
      )
    }
  }, [open, item, form])

  const onSubmit = async (values: CatalogFormValues) => {
    const payload = {
      code: values.code.trim(),
      description: values.description.trim() || null,
      std: values.std,
      price: values.price,
    }
    try {
      if (isEditing && item) {
        await updateItem.mutateAsync({ id: item.id, updates: payload })
        toast.success('Producto del catálogo actualizado')
      } else {
        await createItem.mutateAsync(payload)
        toast.success('Producto agregado al catálogo')
      }
      onOpenChange(false)
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Error desconocido'
      if (msg.includes('duplicate') || msg.includes('23505')) {
        toast.error('Ese código ya existe en el catálogo')
      } else {
        toast.error(isEditing ? 'Error al actualizar' : 'Error al crear', { description: msg })
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Editar producto' : 'Agregar al catálogo'}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="code"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Código URREA</FormLabel>
                  <FormControl>
                    <Input placeholder="Ej: 7420MT" {...field} disabled={isEditing} />
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
                  <FormLabel>Descripción</FormLabel>
                  <FormControl>
                    <Input placeholder="Descripción de URREA" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="std"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>STD (unidades/paquete)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min="1"
                        {...field}
                        value={field.value}
                        onChange={(e) => field.onChange(parseInt(e.target.value, 10) || 1)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="price"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Precio de catálogo</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="—"
                        value={field.value ?? ''}
                        onChange={(e) =>
                          field.onChange(e.target.value === '' ? null : parseFloat(e.target.value))
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="flex justify-end gap-2 pt-4">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={createItem.isPending || updateItem.isPending}>
                {createItem.isPending || updateItem.isPending
                  ? 'Guardando...'
                  : isEditing
                    ? 'Actualizar'
                    : 'Agregar'}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
