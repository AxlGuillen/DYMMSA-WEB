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
import { Button } from '@/components/ui/button'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'
import { Upload, FileSpreadsheet, AlertTriangle } from 'lucide-react'
import { useImportInventory } from '@/hooks/useInventory'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface InventoryImporterProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function InventoryImporter({ open, onOpenChange }: InventoryImporterProps) {
  const [file, setFile] = useState<File | null>(null)
  const [mode, setMode] = useState<'upsert' | 'replace'>('upsert')
  const importMutation = useImportInventory()

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      setFile(acceptedFiles[0])
    }
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

  const handleImport = async () => {
    if (!file) return

    const formData = new FormData()
    formData.append('file', file)
    formData.append('mode', mode)

    try {
      const result = await importMutation.mutateAsync(formData)

      toast.success('Importacion completada', {
        description: `${result.imported} agregados, ${result.updated} actualizados, ${result.errors} errores`,
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
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Importar Inventario</DialogTitle>
          <DialogDescription>
            Sube un archivo Excel con columnas MODEL_CODE y QUANTITY
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Dropzone */}
          <div
            {...getRootProps()}
            className={cn(
              'border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors',
              isDragActive ? 'border-primary bg-primary/5' : 'border-muted-foreground/25',
              file && 'border-green-500 bg-green-50'
            )}
          >
            <input {...getInputProps()} />
            {file ? (
              <div className="flex flex-col items-center gap-2">
                <FileSpreadsheet className="h-10 w-10 text-green-600" />
                <p className="font-medium">{file.name}</p>
                <p className="text-sm text-muted-foreground">
                  {(file.size / 1024).toFixed(1)} KB
                </p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <Upload className="h-10 w-10 text-muted-foreground" />
                <p>Arrastra un archivo Excel o haz click para seleccionar</p>
                <p className="text-sm text-muted-foreground">
                  .xlsx, .xls, .xlsm
                </p>
              </div>
            )}
          </div>

          {/* Import mode */}
          <div className="space-y-3">
            <Label className="text-base">Modo de importacion</Label>
            <RadioGroup value={mode} onValueChange={(v: string) => setMode(v as 'upsert' | 'replace')}>
              <div className="flex items-start space-x-3 rounded-md border p-3">
                <RadioGroupItem value="upsert" id="upsert" className="mt-1" />
                <div className="space-y-1">
                  <Label htmlFor="upsert" className="font-medium cursor-pointer">
                    Actualizar existentes
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    Agrega nuevos productos y actualiza la cantidad de los existentes
                  </p>
                </div>
              </div>
              <div className="flex items-start space-x-3 rounded-md border border-yellow-200 bg-yellow-50/50 p-3">
                <RadioGroupItem value="replace" id="replace" className="mt-1" />
                <div className="space-y-1">
                  <Label htmlFor="replace" className="font-medium cursor-pointer flex items-center gap-2">
                    Reemplazar todo
                    <AlertTriangle className="h-4 w-4 text-yellow-600" />
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    Elimina todo el inventario actual y lo reemplaza con el archivo
                  </p>
                </div>
              </div>
            </RadioGroup>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={handleClose}>
              Cancelar
            </Button>
            <Button
              onClick={handleImport}
              disabled={!file || importMutation.isPending}
            >
              {importMutation.isPending ? 'Importando...' : 'Importar'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
