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
import { Upload, FileSpreadsheet, X } from 'lucide-react'
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
                <FileSpreadsheet className="h-10 w-10 text-green-600" />
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
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <>
                <Upload className="mb-4 h-10 w-10 text-muted-foreground" />
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
              accept=".xlsx,.xls,.xlsm"
              onChange={handleFileSelect}
              className="hidden"
            />
          </div>

          <div className="space-y-2">
            <Label>Modo de importacion</Label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="mode"
                  value="upsert"
                  checked={mode === 'upsert'}
                  onChange={() => setMode('upsert')}
                  className="h-4 w-4"
                />
                <span className="text-sm">Actualizar existentes y agregar nuevos</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="mode"
                  value="insert"
                  checked={mode === 'insert'}
                  onChange={() => setMode('insert')}
                  className="h-4 w-4"
                />
                <span className="text-sm">Solo agregar nuevos</span>
              </label>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={handleClose}>
              Cancelar
            </Button>
            <Button
              onClick={handleImport}
              disabled={!file || importProducts.isPending}
            >
              {importProducts.isPending ? 'Importando...' : 'Importar'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
