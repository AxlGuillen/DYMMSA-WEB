'use client'

import { useState } from 'react'
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
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ChevronDown, Plus, X } from '@/components/icons'
import { useBrands, useCreateBrand, useCreateSupplier, useUpdateSupplier } from '@/hooks/useSuppliers'
import { toast } from 'sonner'
import type { SupplierWithBrands } from '@/types/database'

const supplierSchema = z.object({
  name: z.string().min(1, 'El nombre es requerido'),
  whatsapp: z.string(),
  phone: z.string(),
  email: z.string().email('Correo inválido').or(z.literal('')),
  address: z.string(),
  notes: z.string(),
})

type SupplierFormValues = z.infer<typeof supplierSchema>

interface SupplierFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  supplier?: SupplierWithBrands | null
}

export function SupplierForm({ open, onOpenChange, supplier }: SupplierFormProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{supplier ? 'Editar proveedor' : 'Registrar proveedor'}</DialogTitle>
        </DialogHeader>
        {/* Radix desmonta el content al cerrar → el body se monta fresco en cada
            apertura y su estado inicial sale de props sin effects. */}
        <SupplierFormBody
          key={supplier?.id ?? 'new'}
          supplier={supplier ?? null}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  )
}

function SupplierFormBody({
  supplier,
  onClose,
}: {
  supplier: SupplierWithBrands | null
  onClose: () => void
}) {
  const isEditing = !!supplier
  const createSupplier = useCreateSupplier()
  const updateSupplier = useUpdateSupplier()
  const { data: brands = [] } = useBrands()
  const createBrand = useCreateBrand()

  // Marcas seleccionadas — fuera de RHF (lista de ids, UI de etiquetas).
  const [brandIds, setBrandIds] = useState<string[]>(
    () => supplier?.brands.map((b) => b.id) ?? [],
  )
  const [newBrand, setNewBrand] = useState('')

  const form = useForm<SupplierFormValues>({
    resolver: zodResolver(supplierSchema),
    defaultValues: {
      name: supplier?.name ?? '',
      whatsapp: supplier?.whatsapp ?? '',
      phone: supplier?.phone ?? '',
      email: supplier?.email ?? '',
      address: supplier?.address ?? '',
      notes: supplier?.notes ?? '',
    },
  })

  const toggleBrand = (id: string) => {
    setBrandIds((prev) => (prev.includes(id) ? prev.filter((b) => b !== id) : [...prev, id]))
  }

  // Crea la marca al vuelo y la deja seleccionada.
  const handleCreateBrand = async () => {
    const name = newBrand.trim()
    if (!name) return
    try {
      const brand = await createBrand.mutateAsync(name)
      setBrandIds((prev) => [...prev, brand.id])
      setNewBrand('')
      toast.success(`Marca "${brand.name}" creada`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al crear la marca')
    }
  }

  const selectedBrands = brands.filter((b) => brandIds.includes(b.id))

  const onSubmit = async (values: SupplierFormValues) => {
    const payload = {
      name: values.name.trim(),
      whatsapp: values.whatsapp.trim() || null,
      phone: values.phone.trim() || null,
      email: values.email.trim() || null,
      address: values.address.trim() || null,
      notes: values.notes.trim() || null,
      brandIds,
    }
    try {
      if (isEditing && supplier) {
        await updateSupplier.mutateAsync({ id: supplier.id, updates: payload })
        toast.success('Proveedor actualizado')
      } else {
        await createSupplier.mutateAsync(payload)
        toast.success('Proveedor registrado')
      }
      onClose()
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Error desconocido'
      if (msg.toLowerCase().includes('ya existe')) {
        toast.error('Ya existe un proveedor con ese nombre')
      } else {
        toast.error(isEditing ? 'Error al actualizar' : 'Error al registrar', { description: msg })
      }
    }
  }

  const isPending = createSupplier.isPending || updateSupplier.isPending

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Nombre *</FormLabel>
              <FormControl>
                <Input placeholder="Ej: Ferretería El Tornillo" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="whatsapp"
            render={({ field }) => (
              <FormItem>
                <FormLabel>WhatsApp</FormLabel>
                <FormControl>
                  <Input placeholder="443 123 4567" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="phone"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Teléfono</FormLabel>
                <FormControl>
                  <Input placeholder="443 765 4321" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Correo electrónico</FormLabel>
              <FormControl>
                <Input type="email" placeholder="ventas@proveedor.mx" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="address"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Dirección</FormLabel>
              <FormControl>
                <Input placeholder="Calle, número, colonia" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* ── Marcas que maneja (etiquetas) ── */}
        <div className="space-y-2">
          <p className="text-sm font-medium">Marcas que maneja</p>
          {selectedBrands.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {selectedBrands.map((brand) => (
                <Badge key={brand.id} variant="secondary" className="gap-1 pr-1 font-normal">
                  {brand.name}
                  <button
                    type="button"
                    onClick={() => toggleBrand(brand.id)}
                    className="rounded-full p-0.5 hover:bg-muted-foreground/20"
                    aria-label={`Quitar ${brand.name}`}
                  >
                    <X className="size-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" size="sm" className="gap-1.5">
                  Elegir marcas
                  {brandIds.length > 0 && (
                    <Badge variant="secondary" className="px-1.5 text-xs">{brandIds.length}</Badge>
                  )}
                  <ChevronDown className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="max-h-72 w-56 overflow-y-auto">
                <DropdownMenuLabel>Marcas</DropdownMenuLabel>
                {brands.map((brand) => (
                  <DropdownMenuCheckboxItem
                    key={brand.id}
                    checked={brandIds.includes(brand.id)}
                    onCheckedChange={() => toggleBrand(brand.id)}
                    // El menú se queda abierto para elegir varias de corrido.
                    onSelect={(e) => e.preventDefault()}
                  >
                    {brand.name}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <div className="flex flex-1 gap-1.5">
              <Input
                value={newBrand}
                onChange={(e) => setNewBrand(e.target.value)}
                placeholder="Nueva marca…"
                className="h-9 uppercase"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleCreateBrand()
                  }
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 shrink-0"
                onClick={handleCreateBrand}
                disabled={!newBrand.trim() || createBrand.isPending}
                title="Crear marca y asignarla"
              >
                <Plus className="size-4" />
              </Button>
            </div>
          </div>
        </div>

        <FormField
          control={form.control}
          name="notes"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Notas</FormLabel>
              <FormControl>
                <Input placeholder="Horarios, condiciones, quién atiende…" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex justify-end gap-2 pt-4">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={isPending}>
            {isPending ? 'Guardando…' : isEditing ? 'Actualizar' : 'Registrar'}
          </Button>
        </div>
      </form>
    </Form>
  )
}
