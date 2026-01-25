'use client'

import { useState, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Upload, FileSpreadsheet, X, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

interface FileUploaderProps {
  onFileSelected: (file: File) => void
  isLoading?: boolean
}

export function FileUploader({ onFileSelected, isLoading }: FileUploaderProps) {
  const [file, setFile] = useState<File | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

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

  const handleProcess = () => {
    if (file) {
      onFileSelected(file)
    }
  }

  const handleClear = () => {
    setFile(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <div
          className={`
            relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 transition-colors
            ${isDragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/25'}
            ${file ? 'bg-muted/50' : 'hover:border-muted-foreground/50'}
          `}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {file ? (
            <div className="flex flex-col items-center gap-4">
              <div className="flex items-center gap-3">
                <FileSpreadsheet className="h-12 w-12 text-green-600" />
                <div>
                  <p className="font-medium text-lg">{file.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {(file.size / 1024).toFixed(1)} KB
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="ml-2"
                  onClick={handleClear}
                  disabled={isLoading}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <Button onClick={handleProcess} disabled={isLoading} size="lg">
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Procesando...
                  </>
                ) : (
                  'Procesar archivo'
                )}
              </Button>
            </div>
          ) : (
            <>
              <Upload className="mb-4 h-12 w-12 text-muted-foreground" />
              <p className="mb-2 text-lg font-medium">
                Arrastra un archivo Excel aqui
              </p>
              <p className="mb-4 text-sm text-muted-foreground">
                El sistema buscara la columna ETM en todas las hojas
              </p>
              <Button
                variant="outline"
                size="lg"
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
      </CardContent>
    </Card>
  )
}
