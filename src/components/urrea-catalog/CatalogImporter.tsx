'use client'

import { useState, useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'
import { Upload, FileSpreadsheet, AlertTriangle } from 'lucide-react'
import { useImportUrreaCatalog, useUrreaCatalogStats } from '@/hooks/useUrreaCatalog'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface CatalogImporterProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CatalogImporter({ open, onOpenChange }: CatalogImporterProps) {
  const [file, setFile] = useState<File | null>(null)
  const [mode, setMode] = useState<'upsert' | 'replace'>('upsert')
  const [confirmReplace, setConfirmReplace] = useState(false)
  const importMutation = useImportUrreaCatalog()
  const { data: stats } = useUrreaCatalogStats()

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) setFile(acceptedFiles[0])
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.ms-excel': ['.xls'],
      'application/vnd.ms-excel.sheet.macroEnabled.12': ['.xlsm'],
    },
    maxFiles: 1,
  })

  const handleImportClick = () => {
    if (!file) return
    if (mode === 'replace') {
      setConfirmReplace(true)
      return
    }
    handleImport()
  }

  const handleImport = async () => {
    if (!file) return
    setConfirmReplace(false)
    const formData = new FormData()
    formData.append('file', file)
    formData.append('mode', mode)
    try {
      const result = await importMutation.mutateAsync(formData)
      toast.success('Importación completada', {
        description: `${result.imported} procesados${result.errors ? `, ${result.errors} errores` : ''}`,
      })
      handleClose()
    } catch (error) {
      toast.error('Error al importar', {
        description: error instanceof Error ? error.message : 'Error desconocido',
      })
    }
  }

  const handleClose = () => {
    setFile(null)
    setMode('upsert')
    setConfirmReplace(false)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Importar catálogo URREA</DialogTitle>
          <DialogDescription>
            Sube un Excel con columnas <strong>codigo</strong>, <strong>descripcion</strong>,{' '}
            <strong>std</strong> y <strong>precio</strong>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <div
            {...getRootProps()}
            className={cn(
              'border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors',
              isDragActive ? 'border-primary bg-primary/5' : 'border-muted-foreground/25',
              file && 'border-green-500 bg-green-50 dark:bg-green-950/20'
            )}
          >
            <input {...getInputProps()} />
            {file ? (
              <div className="flex flex-col items-center gap-2">
                <FileSpreadsheet className="size-10 text-green-600" />
                <p className="font-medium">{file.name}</p>
                <p className="text-sm text-muted-foreground">{(file.size / 1024).toFixed(1)} KB</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <Upload className="size-10 text-muted-foreground" />
                <p>Arrastra un archivo Excel o haz click para seleccionar</p>
                <p className="text-sm text-muted-foreground">.xlsx, .xls, .xlsm</p>
              </div>
            )}
          </div>

          <div className="space-y-3">
            <Label className="text-base">Modo de importación</Label>
            <RadioGroup value={mode} onValueChange={(v: string) => setMode(v as 'upsert' | 'replace')}>
              <div className="flex items-start gap-x-3 rounded-md border p-3">
                <RadioGroupItem value="upsert" id="upsert" className="mt-1" />
                <div className="space-y-1">
                  <Label htmlFor="upsert" className="font-medium cursor-pointer">
                    Actualizar o agregar
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    Agrega productos nuevos y actualiza los existentes (por código).
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-x-3 rounded-md border border-yellow-200 bg-yellow-50/50 dark:bg-yellow-950/20 p-3">
                <RadioGroupItem value="replace" id="replace" className="mt-1" />
                <div className="space-y-1">
                  <Label htmlFor="replace" className="font-medium cursor-pointer flex items-center gap-2">
                    Reemplazar todo
                    <AlertTriangle className="size-4 text-yellow-600" />
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    Elimina todo el catálogo actual y lo reemplaza con el archivo.
                  </p>
                </div>
              </div>
            </RadioGroup>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={handleClose}>
              Cancelar
            </Button>
            <Button onClick={handleImportClick} disabled={!file || importMutation.isPending}>
              {importMutation.isPending ? 'Importando...' : 'Importar'}
            </Button>
          </div>
        </div>
      </DialogContent>

      <AlertDialog open={confirmReplace} onOpenChange={setConfirmReplace}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Reemplazar todo el catálogo?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. Se eliminarán{' '}
              {stats?.total ? <strong>{stats.total} productos</strong> : 'todos los productos'}{' '}
              del catálogo URREA y se reemplazarán con el contenido del archivo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleImport}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Reemplazar todo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  )
}
