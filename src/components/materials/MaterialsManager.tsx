'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Plus, Ruler, Trash2 } from '@/components/icons'
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  useDeletePresentation,
  useMaterialPresentations,
  useSavePresentation,
} from '@/hooks/useCutPlan'
import { formatMm } from '@/lib/cut-plan'
import type { CutMaterialType, MaterialPresentation } from '@/types/database'

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })

/**
 * Control de medidas de material (issue #71): el catálogo de presentaciones
 * del proveedor se ARMA SOLO al capturar en los planificadores de corte —
 * esta página es donde se corrige: ver todo lo registrado, dar de alta a
 * mano y borrar capturas erróneas.
 */
export function MaterialsManager() {
  const { data, isLoading, error } = useMaterialPresentations()
  const savePresentation = useSavePresentation('standalone')
  const deletePresentation = useDeletePresentation()

  const [toDelete, setToDelete] = useState<MaterialPresentation | null>(null)
  // Formularios de alta manual (inputs como string, patrón del CutPlanner).
  const [tubeForm, setTubeForm] = useState({ diameter: '', length: '' })
  const [plateForm, setPlateForm] = useState({ thickness: '', width: '', length: '' })

  if (isLoading) return <MaterialsSkeleton />
  if (error || !data) {
    return (
      <div className="rounded-md border p-8 text-center">
        <p className="text-muted-foreground">No se pudieron cargar las medidas registradas</p>
      </div>
    )
  }

  const tubes = data.presentations.filter((p) => p.material_type === 'tube')
  const plates = data.presentations.filter((p) => p.material_type === 'plate')

  const describe = (p: MaterialPresentation) =>
    p.material_type === 'tube'
      ? `barra Ø${p.diameter_mm} mm × ${formatMm(p.length_mm)}`
      : `hoja de ${p.thickness_mm} mm · ${formatMm(p.width_mm ?? 0)} × ${formatMm(p.length_mm)}`

  const handleAdd = async (type: CutMaterialType) => {
    const payload =
      type === 'tube'
        ? { material_type: type, diameter_mm: Number(tubeForm.diameter), length_mm: Number(tubeForm.length) }
        : {
            material_type: type,
            thickness_mm: Number(plateForm.thickness),
            width_mm: Number(plateForm.width),
            length_mm: Number(plateForm.length),
          }
    try {
      await savePresentation.mutateAsync(payload)
      if (type === 'tube') setTubeForm({ diameter: '', length: '' })
      else setPlateForm({ thickness: '', width: '', length: '' })
      toast.success('Medida registrada')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo registrar la medida')
    }
  }

  const handleDelete = async () => {
    if (!toDelete) return
    try {
      await deletePresentation.mutateAsync(toDelete.id)
      toast.success('Medida eliminada')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo eliminar la medida')
    } finally {
      setToDelete(null)
    }
  }

  const canAddTube = Number(tubeForm.diameter) > 0 && Number(tubeForm.length) > 0
  const canAddPlate =
    Number(plateForm.thickness) > 0 && Number(plateForm.width) > 0 && Number(plateForm.length) > 0

  const deleteButton = (p: MaterialPresentation) => (
    <Button
      size="icon" variant="ghost"
      className="size-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
      aria-label={`Eliminar ${describe(p)}`}
      onClick={() => setToDelete(p)}
    >
      <Trash2 className="size-4" />
    </Button>
  )

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <Ruler className="mt-1 size-6 shrink-0 text-muted-foreground" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Medidas de material</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Barras y hojas que ofrece el proveedor. Se registran solas al capturarlas en un
            plan de corte; aquí se corrigen las erróneas o se dan de alta a mano.
          </p>
        </div>
      </div>

      {/* Tubos */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Barras de tubo ({tubes.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {tubes.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin barras registradas.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[140px]">Diámetro</TableHead>
                  <TableHead className="w-[160px]">Largo de la barra</TableHead>
                  <TableHead>Último uso</TableHead>
                  <TableHead className="w-[60px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {tubes.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="tabular-nums">Ø{p.diameter_mm} mm</TableCell>
                    <TableCell className="tabular-nums">{formatMm(p.length_mm)}</TableCell>
                    <TableCell className="text-muted-foreground">{fmtDate(p.last_used_at)}</TableCell>
                    <TableCell>{deleteButton(p)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="number" min="0" className="h-8 w-32" placeholder="Ø (mm)"
              aria-label="Diámetro del tubo (mm)" value={tubeForm.diameter}
              onChange={(e) => setTubeForm((f) => ({ ...f, diameter: e.target.value }))}
            />
            <Input
              type="number" min="0" className="h-8 w-32" placeholder="largo (mm)"
              aria-label="Largo de la barra (mm)" value={tubeForm.length}
              onChange={(e) => setTubeForm((f) => ({ ...f, length: e.target.value }))}
            />
            <Button
              size="sm" variant="outline"
              disabled={!canAddTube || savePresentation.isPending}
              onClick={() => handleAdd('tube')}
            >
              {savePresentation.isPending ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Plus className="mr-2 size-4" />
              )}
              Agregar barra
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Placas */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Hojas de placa ({plates.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {plates.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin hojas registradas.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[140px]">Espesor</TableHead>
                  <TableHead className="w-[200px]">Hoja (ancho × largo)</TableHead>
                  <TableHead>Último uso</TableHead>
                  <TableHead className="w-[60px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {plates.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="tabular-nums">{p.thickness_mm} mm</TableCell>
                    <TableCell className="tabular-nums">
                      {formatMm(p.width_mm ?? 0)} × {formatMm(p.length_mm)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{fmtDate(p.last_used_at)}</TableCell>
                    <TableCell>{deleteButton(p)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="number" min="0" className="h-8 w-32" placeholder="espesor (mm)"
              aria-label="Espesor de la placa (mm)" value={plateForm.thickness}
              onChange={(e) => setPlateForm((f) => ({ ...f, thickness: e.target.value }))}
            />
            <Input
              type="number" min="0" className="h-8 w-32" placeholder="ancho (mm)"
              aria-label="Ancho de la hoja (mm)" value={plateForm.width}
              onChange={(e) => setPlateForm((f) => ({ ...f, width: e.target.value }))}
            />
            <Input
              type="number" min="0" className="h-8 w-32" placeholder="largo (mm)"
              aria-label="Largo de la hoja (mm)" value={plateForm.length}
              onChange={(e) => setPlateForm((f) => ({ ...f, length: e.target.value }))}
            />
            <Button
              size="sm" variant="outline"
              disabled={!canAddPlate || savePresentation.isPending}
              onClick={() => handleAdd('plate')}
            >
              {savePresentation.isPending ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Plus className="mr-2 size-4" />
              )}
              Agregar hoja
            </Button>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={!!toDelete} onOpenChange={(open) => { if (!open) setToDelete(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar esta medida?</AlertDialogTitle>
            <AlertDialogDescription>
              Se elimina la {toDelete ? describe(toDelete) : 'medida'} del catálogo. Los planes
              de corte existentes no se tocan — solo deja de sugerirse en planes futuros.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={handleDelete}
            >
              {deletePresentation.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function MaterialsSkeleton() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-4 w-96" />
      </div>
      {Array.from({ length: 2 }).map((_, i) => (
        <div key={i} className="space-y-3 rounded-lg border p-4">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-24 w-full" />
        </div>
      ))}
    </div>
  )
}
