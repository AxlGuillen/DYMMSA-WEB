'use client'

import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useCreateProduct, useUpdateProduct } from '@/hooks/useProducts'
import { useCatalogDescription } from '@/hooks/useUrreaCatalog'
import { toast } from 'sonner'
import { Loader2 } from '@/components/icons'
import type { EtmProduct } from '@/types/database'

const productSchema = z.object({
  etm: z.string().min(1, 'ETM es requerido'),
  description: z.string(),
  description_es: z.string().min(1, 'Descripcion es requerida'),
  dymmsa_description: z.string(),
  model_code: z.string().min(1, 'Modelo es requerido'),
  price: z.number().min(0, 'Precio debe ser mayor o igual a 0'),
  brand: z.string(),
  is_sold: z.boolean().nullable(), // tri-estado: null=sin definir, true=lo vendemos, false=no
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
      description_es: '',
      dymmsa_description: '',
      model_code: '',
      price: 0,
      brand: 'URREA',
      is_sold: null,
    },
  })

  // Reset form when product changes or dialog opens
  useEffect(() => {
    // oxlint-disable-next-line react-doctor/no-event-handler -- intentional pattern; structural refactor tracked separately
    if (open) {
      if (product) {
        form.reset({
          etm: product.etm || '',
          description: product.description || '',
          description_es: product.description_es || '',
          dymmsa_description: product.dymmsa_description || '',
          model_code: product.model_code || '',
          price: product.price || 0,
          brand: product.brand || 'URREA',
          is_sold: product.is_sold ?? null,
        })
      } else {
        form.reset({
          etm: '',
          description: '',
          description_es: '',
          dymmsa_description: '',
          model_code: '',
          price: 0,
          brand: 'URREA',
          is_sold: null,
        })
      }
    }
  }, [open, product, form])

  // Match de catálogo por (model_code, brand): si existe, la oficial gana jerarquía
  // y la curada no se edita aquí.
  // watch() de react-hook-form es incompatible conocido del React Compiler:
  // este componente simplemente se queda sin auto-memoizar.
  // eslint-disable-next-line react-hooks/incompatible-library
  const modelCodeValue = form.watch('model_code')
  const brandValue = form.watch('brand')
  const [debounced, setDebounced] = useState({ code: '', brand: '' })
  useEffect(() => {
    const t = setTimeout(
      () => setDebounced({ code: modelCodeValue ?? '', brand: brandValue ?? '' }),
      400,
    )
    return () => clearTimeout(t)
  }, [modelCodeValue, brandValue])
  const { data: catalogDesc } = useCatalogDescription(open ? debounced.code : '', debounced.brand)

  const onSubmit = async (values: ProductFormValues) => {
    try {
      // Con match de catálogo la curada no se editó aquí: preservar la existente.
      const payload = catalogDesc
        ? { ...values, dymmsa_description: product?.dymmsa_description ?? '' }
        : values
      if (isEditing && product) {
        await updateProduct.mutateAsync({
          id: product.id,
          updates: payload,
        })
        toast.success('Producto actualizado')
      } else {
        await createProduct.mutateAsync({
          ...payload,
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
          <DialogDescription>
            {isEditing
              ? 'Modifica los campos del producto. El código ETM no puede cambiarse.'
              : 'Completa los datos del nuevo producto al catálogo ETM.'}
          </DialogDescription>
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
                      className={isEditing ? 'font-mono bg-muted' : 'font-mono'}
                    />
                  </FormControl>
                  {isEditing && (
                    <p className="text-xs text-muted-foreground">
                      El código ETM es el identificador único y no puede modificarse.
                    </p>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="description_es"
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
            <FormField
              control={form.control}
              name="dymmsa_description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Descripción DYMMSA</FormLabel>
                  <FormControl>
                    {catalogDesc ? (
                      <Input value={catalogDesc} disabled />
                    ) : (
                      <Input placeholder="Descripción propia de DYMMSA" {...field} />
                    )}
                  </FormControl>
                  {catalogDesc && (
                    <p className="text-xs text-muted-foreground">
                      Oficial del catálogo URREA {'\u2014'} se corrige reimportando el catálogo.
                    </p>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="model_code"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Código Modelo</FormLabel>
                    <FormControl>
                      <Input placeholder="Codigo modelo" {...field} />
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
              name="brand"
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
            <FormField
              control={form.control}
              name="is_sold"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>¿Lo vendemos?</FormLabel>
                  <Select
                    value={field.value === null ? 'undefined' : String(field.value)}
                    onValueChange={(val) =>
                      field.onChange(val === 'undefined' ? null : val === 'true')
                    }
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="undefined">Sin definir</SelectItem>
                      <SelectItem value="true">Sí lo vendemos</SelectItem>
                      <SelectItem value="false">No lo vendemos</SelectItem>
                    </SelectContent>
                  </Select>
                  {field.value === false && (
                    <p className="text-xs text-muted-foreground">
                      Los productos no vendibles se saltan en el cotizador y aparecen como
                      &quot;No disponible&quot; al cliente.
                    </p>
                  )}
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
                {(createProduct.isPending || updateProduct.isPending) && (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                )}
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
