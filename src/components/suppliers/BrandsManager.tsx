'use client'

import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Check, Pencil, Plus, Trash2, X } from '@/components/icons'
import {
  useBrands,
  useCreateBrand,
  useUpdateBrand,
  useDeleteBrand,
} from '@/hooks/useSuppliers'
import { toast } from 'sonner'

interface BrandsManagerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Submódulo de marcas (issue #21): crear, renombrar y eliminar marcas del
 * catálogo global. Eliminar una marca asignada a proveedores está bloqueado
 * (botón deshabilitado con hint; el 400 del server es el backstop).
 */
export function BrandsManager({ open, onOpenChange }: BrandsManagerProps) {
  const { data: brands = [], isLoading } = useBrands()
  const createBrand = useCreateBrand()
  const updateBrand = useUpdateBrand()
  const deleteBrand = useDeleteBrand()

  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')

  const handleCreate = async () => {
    const name = newName.trim()
    if (!name) return
    try {
      const brand = await createBrand.mutateAsync(name)
      setNewName('')
      toast.success(`Marca "${brand.name}" creada`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al crear la marca')
    }
  }

  const handleRename = async () => {
    if (!editingId) return
    const name = editingName.trim()
    if (!name) return
    try {
      await updateBrand.mutateAsync({ id: editingId, name })
      toast.success('Marca renombrada')
      setEditingId(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al renombrar la marca')
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await deleteBrand.mutateAsync(id)
      toast.success('Marca eliminada')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al eliminar la marca')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Marcas</DialogTitle>
          <DialogDescription>
            Catálogo global de marcas para etiquetar proveedores. Las marcas asignadas a algún
            proveedor no se pueden eliminar hasta desasignarlas.
          </DialogDescription>
        </DialogHeader>

        {/* Crear */}
        <div className="flex gap-2">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Nueva marca…"
            className="uppercase"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                handleCreate()
              }
            }}
          />
          <Button
            onClick={handleCreate}
            disabled={!newName.trim() || createBrand.isPending}
            className="shrink-0"
          >
            <Plus className="mr-1.5 size-4" />
            Crear
          </Button>
        </div>

        {/* Lista */}
        <div className="max-h-80 space-y-1 overflow-y-auto pr-1">
          {isLoading && <p className="py-4 text-center text-sm text-muted-foreground">Cargando…</p>}
          {!isLoading && brands.length === 0 && (
            <p className="py-4 text-center text-sm text-muted-foreground">No hay marcas registradas.</p>
          )}
          {brands.map((brand) => (
            <div
              key={brand.id}
              className="flex items-center gap-2 rounded-md border px-3 py-2"
            >
              {editingId === brand.id ? (
                <>
                  <Input
                    autoFocus
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    className="h-8 uppercase"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); handleRename() }
                      if (e.key === 'Escape') setEditingId(null)
                    }}
                  />
                  <Button
                    size="icon" variant="ghost" className="size-8 shrink-0"
                    onClick={handleRename}
                    disabled={updateBrand.isPending}
                    title="Guardar"
                  >
                    <Check className="size-4" />
                  </Button>
                  <Button
                    size="icon" variant="ghost" className="size-8 shrink-0"
                    onClick={() => setEditingId(null)}
                    title="Cancelar"
                  >
                    <X className="size-4" />
                  </Button>
                </>
              ) : (
                <>
                  <span className="flex-1 text-sm font-medium">{brand.name}</span>
                  <Badge variant="secondary" className="font-normal tabular-nums">
                    {brand.suppliersCount} prov.
                  </Badge>
                  <Button
                    size="icon" variant="ghost" className="size-8 shrink-0"
                    onClick={() => { setEditingId(brand.id); setEditingName(brand.name) }}
                    title="Renombrar"
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button
                    size="icon" variant="ghost"
                    className="size-8 shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
                    onClick={() => handleDelete(brand.id)}
                    disabled={brand.suppliersCount > 0 || deleteBrand.isPending}
                    title={
                      brand.suppliersCount > 0
                        ? `Asignada a ${brand.suppliersCount} proveedor${brand.suppliersCount !== 1 ? 'es' : ''} — quítala antes de eliminarla`
                        : 'Eliminar'
                    }
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </>
              )}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
