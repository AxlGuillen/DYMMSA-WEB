'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import {
  Download,
  RotateCcw,
  Loader2,
  FileSpreadsheet,
  CheckCircle,
  XCircle,
  DollarSign,
  ChevronDown,
  ChevronUp,
  Copy,
} from 'lucide-react'
import type { EtmProduct } from '@/types/database'
import { toast } from 'sonner'

interface QuotePreviewProps {
  filename: string
  totalRequested: number
  matchedProducts: EtmProduct[]
  unmatchedEtms: string[]
  onDownload: () => void
  onReset: () => void
  isDownloading?: boolean
}

export function QuotePreview({
  filename,
  totalRequested,
  matchedProducts,
  unmatchedEtms,
  onDownload,
  onReset,
  isDownloading,
}: QuotePreviewProps) {
  const [showUnmatched, setShowUnmatched] = useState(false)

  const matchPercentage =
    totalRequested > 0
      ? Math.round((matchedProducts.length / totalRequested) * 100)
      : 0

  const total = matchedProducts.reduce((sum, p) => sum + (p.precio || 0), 0)

  const getMatchColor = (percentage: number) => {
    if (percentage >= 80) return 'text-green-600'
    if (percentage >= 50) return 'text-yellow-600'
    return 'text-red-600'
  }

  const handleCopyUnmatched = () => {
    navigator.clipboard.writeText(unmatchedEtms.join('\n'))
    toast.success('ETMs copiados al portapapeles')
  }

  return (
    <div className="space-y-6">
      {/* Estadisticas */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Archivo</CardDescription>
            <CardTitle className="flex items-center gap-2 text-lg">
              <FileSpreadsheet className="h-5 w-5 text-muted-foreground" />
              <span className="truncate" title={filename}>
                {filename}
              </span>
            </CardTitle>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>ETMs Solicitados</CardDescription>
            <CardTitle className="text-2xl">{totalRequested}</CardTitle>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Encontrados en BD</CardDescription>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-600" />
              <span className="text-2xl">{matchedProducts.length}</span>
              <Badge
                variant="outline"
                className={getMatchColor(matchPercentage)}
              >
                {matchPercentage}%
              </Badge>
            </CardTitle>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Valor Total</CardDescription>
            <CardTitle className="flex items-center gap-2 text-2xl">
              <DollarSign className="h-5 w-5 text-green-600" />
              {total.toLocaleString('es-MX', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* ETMs no encontrados */}
      {unmatchedEtms.length > 0 && (
        <Card className="border-yellow-200 bg-yellow-50/50">
          <CardHeader className="pb-2">
            <button
              onClick={() => setShowUnmatched(!showUnmatched)}
              className="flex w-full items-center justify-between text-left"
            >
              <div className="flex items-center gap-2">
                <XCircle className="h-5 w-5 text-yellow-600" />
                <CardTitle className="text-base">
                  {unmatchedEtms.length} ETMs no encontrados
                </CardTitle>
              </div>
              {showUnmatched ? (
                <ChevronUp className="h-5 w-5" />
              ) : (
                <ChevronDown className="h-5 w-5" />
              )}
            </button>
          </CardHeader>
          {showUnmatched && (
            <CardContent>
              <div className="flex items-start justify-between gap-4">
                <div className="flex flex-wrap gap-2">
                  {unmatchedEtms.map((etm) => (
                    <Badge key={etm} variant="secondary">
                      {etm}
                    </Badge>
                  ))}
                </div>
                <Button variant="outline" size="sm" onClick={handleCopyUnmatched}>
                  <Copy className="mr-2 h-4 w-4" />
                  Copiar
                </Button>
              </div>
            </CardContent>
          )}
        </Card>
      )}

      {/* Tabla de productos */}
      {matchedProducts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Productos encontrados</CardTitle>
            <CardDescription>
              {matchedProducts.length} productos listos para cotizar
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="max-h-[400px] overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ETM</TableHead>
                    <TableHead className="min-w-[300px]">Descripcion</TableHead>
                    <TableHead>Modelo</TableHead>
                    <TableHead className="text-right">Precio</TableHead>
                    <TableHead>Marca</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {matchedProducts.map((product) => (
                    <TableRow key={product.id}>
                      <TableCell className="font-mono">{product.etm}</TableCell>
                      <TableCell>
                        {product.descripcion || product.description}
                      </TableCell>
                      <TableCell>{product.modelo}</TableCell>
                      <TableCell className="text-right">
                        $
                        {product.precio.toLocaleString('es-MX', {
                          minimumFractionDigits: 2,
                        })}
                      </TableCell>
                      <TableCell>{product.marca}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Acciones */}
      <div className="flex justify-end gap-4">
        <Button variant="outline" onClick={onReset} disabled={isDownloading}>
          <RotateCcw className="mr-2 h-4 w-4" />
          Subir otro archivo
        </Button>
        <Button
          onClick={onDownload}
          disabled={matchedProducts.length === 0 || isDownloading}
          size="lg"
        >
          {isDownloading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Guardando...
            </>
          ) : (
            <>
              <Download className="mr-2 h-4 w-4" />
              Descargar Cotizacion
            </>
          )}
        </Button>
      </div>
    </div>
  )
}
