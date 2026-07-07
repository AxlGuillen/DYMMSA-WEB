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
import { useCreateInventoryItem, useUpdateInventoryItem } from '@/hooks/useInventory'
import { toast } from 'sonner'
import type { StoreInventory } from '@/types/database'

const inventorySchema = z.object({
  model_code: z.string().min(1, 'Codigo modelo es requerido'),
  quantity: z.number().min(0, 'Cantidad debe ser mayor o igual a 0'),
  location: z.string(), // ubicación (gaveta), opcional; '' → null
})

type InventoryFormValues = z.infer<typeof inventorySchema>

interface InventoryFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  item?: StoreInventory | null
}

export function InventoryForm({ open, onOpenChange, item }: InventoryFormProps) {
  const isEditing = !!item
  const createItem = useCreateInventoryItem()
  const updateItem = useUpdateInventoryItem()

  const form = useForm<InventoryFormValues>({
    resolver: zodResolver(inventorySchema),
    defaultValues: {
      model_code: '',
      quantity: 0,
      location: '',
    },
  })

  useEffect(() => {
    // oxlint-disable-next-line react-doctor/no-event-handler -- intentional pattern; structural refactor tracked separately
    if (open) {
      if (item) {
        form.reset({
          model_code: item.model_code || '',
          quantity: item.quantity || 0,
          location: item.location ?? '',
        })
      } else {
        form.reset({
          model_code: '',
          quantity: 0,
          location: '',
        })
      }
    }
  }, [open, item, form])

  const onSubmit = async (values: InventoryFormValues) => {
    const location = values.location.trim() || null
    try {
      if (isEditing && item) {
        await updateItem.mutateAsync({
          id: item.id,
          updates: { quantity: values.quantity, location },
        })
        toast.success('Inventario actualizado')
      } else {
        await createItem.mutateAsync({ ...values, location })
        toast.success('Producto agregado al inventario')
      }
      onOpenChange(false)
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Error desconocido'
      if (errorMessage.includes('duplicate') || errorMessage.includes('23505')) {
        toast.error('Este codigo modelo ya existe en el inventario')
      } else {
        toast.error(isEditing ? 'Error al actualizar' : 'Error al crear', {
          description: errorMessage,
        })
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? 'Editar producto' : 'Agregar al Inventario'}
          </DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="model_code"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Código Modelo</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Ej: 7420MT"
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
              name="quantity"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Cantidad en Stock</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min="0"
                      placeholder="0"
                      {...field}
                      value={field.value}
                      onChange={(e) => field.onChange(parseInt(e.target.value, 10) || 0)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="location"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Ubicación (gaveta)</FormLabel>
                  <FormControl>
                    <Input placeholder="Ej: A-12 (opcional)" {...field} />
                  </FormControl>
                  <p className="text-xs text-muted-foreground">
                    Dónde se guarda en la tienda. Solo se muestra cuando hay stock.
                  </p>
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
                disabled={createItem.isPending || updateItem.isPending}
              >
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
