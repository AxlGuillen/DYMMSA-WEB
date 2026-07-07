'use client'

import { useState, useRef } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Upload, FileSpreadsheet, X, RefreshCw, Plus, Loader2 } from '@/components/icons'
import { useImportProducts } from '@/hooks/useProducts'
import { toast } from 'sonner'

interface ExcelImporterProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ExcelImporter({ open, onOpenChange }: ExcelImporterProps) {
  const [file, setFile] = useState<File | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [mode, setMode] = useState<'upsert' | 'insert'>('upsert')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const importProducts = useImportProducts()

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = () => {
    setIsDragging(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const droppedFile = e.dataTransfer.files[0]
    if (droppedFile && isValidFile(droppedFile)) {
      setFile(droppedFile)
    } else {
      toast.error('Archivo no valido', {
        description: 'Solo se permiten archivos Excel (.xlsx, .xls, .xlsm)',
      })
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (selectedFile && isValidFile(selectedFile)) {
      setFile(selectedFile)
    }
  }

  const isValidFile = (file: File) => {
    const validTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'application/vnd.ms-excel.sheet.macroEnabled.12',
    ]
    const validExtensions = ['.xlsx', '.xls', '.xlsm']
    return (
      validTypes.includes(file.type) ||
      validExtensions.some((ext) => file.name.toLowerCase().endsWith(ext))
    )
  }

  const handleImport = async () => {
    if (!file) return

    const formData = new FormData()
    formData.append('file', file)
    formData.append('mode', mode)

    try {
      const result = await importProducts.mutateAsync(formData)
      toast.success('Importacion completada', {
        description: `${result.imported} productos importados, ${result.updated} actualizados, ${result.errors} errores`,
      })
      onOpenChange(false)
      setFile(null)
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Error desconocido'
      toast.error('Error en la importacion', {
        description: errorMessage,
      })
    }
  }

  const handleClose = () => {
    onOpenChange(false)
    setFile(null)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Importar desde Excel</DialogTitle>
          <DialogDescription>
            Sube un archivo Excel con las columnas: ETM, DESCRIPTION, DESCRIPCION, MODELO, PRECIO, MARCA
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div
            className={`
              relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 transition-colors
              ${isDragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/25'}
              ${file ? 'bg-muted/50' : ''}
            `}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            {file ? (
              <div className="flex items-center gap-3">
                <FileSpreadsheet className="size-10 text-green-600" />
                <div>
                  <p className="font-medium">{file.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {(file.size / 1024).toFixed(1)} KB
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="ml-2"
                  onClick={() => setFile(null)}
                >
                  <X className="size-4" />
                </Button>
              </div>
            ) : (
              <>
                <Upload className="mb-4 size-10 text-muted-foreground" />
                <p className="mb-2 text-sm text-muted-foreground">
                  Arrastra un archivo Excel aqui o
                </p>
                <Button
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                >
                  Seleccionar archivo
                </Button>
              </>
            )}
            <input
              ref={fileInputRef}
              type="file"
              aria-label="Seleccionar archivo Excel"
              accept=".xlsx,.xls,.xlsm"
              onChange={handleFileSelect}
              className="hidden"
            />
          </div>

          <div className="space-y-2">
            <Label>Modo de importacion</Label>
            <RadioGroup
              value={mode}
              onValueChange={(v) => setMode(v as 'upsert' | 'insert')}
              className="grid grid-cols-2 gap-2 pt-1"
            >
              <label
                htmlFor="mode-upsert"
                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                  mode === 'upsert' ? 'border-primary bg-primary/5' : 'border-muted hover:bg-muted/50'
                }`}
              >
                <RadioGroupItem value="upsert" id="mode-upsert" className="mt-0.5" />
                <div>
                  <div className="flex items-center gap-1.5 text-sm font-medium">
                    <RefreshCw className="size-3.5" />
                    Actualizar y agregar
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Sobreescribe existentes y añade nuevos
                  </p>
                </div>
              </label>
              <label
                htmlFor="mode-insert"
                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                  mode === 'insert' ? 'border-primary bg-primary/5' : 'border-muted hover:bg-muted/50'
                }`}
              >
                <RadioGroupItem value="insert" id="mode-insert" className="mt-0.5" />
                <div>
                  <div className="flex items-center gap-1.5 text-sm font-medium">
                    <Plus className="size-3.5" />
                    Solo agregar nuevos
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Ignora ETMs ya existentes
                  </p>
                </div>
              </label>
            </RadioGroup>
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={handleClose}>
              Cancelar
            </Button>
            <Button
              onClick={handleImport}
              disabled={!file || importProducts.isPending}
            >
              {importProducts.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
              {importProducts.isPending ? 'Importando...' : 'Importar'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
