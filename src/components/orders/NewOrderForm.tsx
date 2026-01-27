'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useDropzone } from 'react-dropzone'
import { Upload, FileSpreadsheet, Loader2, AlertCircle, CheckCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { detectApprovedProducts } from '@/lib/excel/detect-approved'
import { useCreateOrder, useAutoLearn } from '@/hooks/useOrders'
import type { ApprovedProduct } from '@/types/database'

interface DetectionResult {
  products: ApprovedProduct[]
  sheetsProcessed: number
  greenRowsFound: number
}

export function NewOrderForm() {
  const router = useRouter()
  const [customerName, setCustomerName] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [detectionResult, setDetectionResult] = useState<DetectionResult | null>(null)

  const createOrder = useCreateOrder()
  const autoLearn = useAutoLearn()

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const uploadedFile = acceptedFiles[0]
    if (!uploadedFile) return

    setFile(uploadedFile)
    setIsProcessing(true)
    setDetectionResult(null)

    try {
      const buffer = await uploadedFile.arrayBuffer()
      const result = await detectApprovedProducts(buffer)

      setDetectionResult({
        products: result.products,
        sheetsProcessed: result.sheetsProcessed,
        greenRowsFound: result.greenRowsFound,
      })

      if (result.products.length === 0) {
        toast.warning('No se encontraron productos con filas verdes')
      } else {
        toast.success(`${result.products.length} productos detectados`)
      }
    } catch (error) {
      console.error('Error processing file:', error)
      toast.error('Error al procesar el archivo')
      setFile(null)
    } finally {
      setIsProcessing(false)
    }
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.ms-excel': ['.xls'],
    },
    maxFiles: 1,
    disabled: isProcessing,
  })

  const handleSubmit = async () => {
    if (!customerName.trim()) {
      toast.error('Ingresa el nombre del cliente')
      return
    }

    if (!detectionResult || detectionResult.products.length === 0) {
      toast.error('No hay productos para procesar')
      return
    }

    try {
      // First, run auto-learn to add new products to catalog
      const autoLearnResult = await autoLearn.mutateAsync(detectionResult.products)

      if (autoLearnResult.added > 0) {
        toast.success(`${autoLearnResult.added} nuevos productos agregados al catálogo`)
      }

      // Then create the order
      const orderResult = await createOrder.mutateAsync({
        customer_name: customerName.trim(),
        products: detectionResult.products,
      })

      toast.success('Orden creada correctamente')
      router.push(`/dashboard/orders/${orderResult.order_id}`)
    } catch (error) {
      console.error('Error creating order:', error)
      toast.error(error instanceof Error ? error.message : 'Error al crear orden')
    }
  }

  const isSubmitting = createOrder.isPending || autoLearn.isPending

  return (
    <div className="space-y-6">
      {/* Customer Name */}
      <Card>
        <CardHeader>
          <CardTitle>Datos del Cliente</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Label htmlFor="customerName">Nombre del Cliente</Label>
            <Input
              id="customerName"
              placeholder="Ej: Construcciones ABC"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              disabled={isSubmitting}
            />
          </div>
        </CardContent>
      </Card>

      {/* File Upload */}
      <Card>
        <CardHeader>
          <CardTitle>Archivo Excel</CardTitle>
          <CardDescription>
            Sube el Excel con los productos aprobados (filas marcadas en verde)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div
            {...getRootProps()}
            className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
              isDragActive
                ? 'border-primary bg-primary/5'
                : file
                  ? 'border-green-500 bg-green-50'
                  : 'border-muted-foreground/25 hover:border-primary'
            } ${isProcessing ? 'pointer-events-none opacity-50' : ''}`}
          >
            <input {...getInputProps()} />

            {isProcessing ? (
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="h-10 w-10 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">
                  Procesando archivo...
                </p>
              </div>
            ) : file ? (
              <div className="flex flex-col items-center gap-2">
                <FileSpreadsheet className="h-10 w-10 text-green-600" />
                <p className="font-medium">{file.name}</p>
                <p className="text-sm text-muted-foreground">
                  Click o arrastra para cambiar
                </p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <Upload className="h-10 w-10 text-muted-foreground" />
                <p className="font-medium">
                  {isDragActive ? 'Suelta el archivo aquí' : 'Arrastra o haz click'}
                </p>
                <p className="text-sm text-muted-foreground">
                  Archivos .xlsx con filas verdes
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Detection Results */}
      {detectionResult && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {detectionResult.products.length > 0 ? (
                <CheckCircle className="h-5 w-5 text-green-600" />
              ) : (
                <AlertCircle className="h-5 w-5 text-yellow-600" />
              )}
              Resultados de Detección
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <p className="text-2xl font-bold">{detectionResult.sheetsProcessed}</p>
                <p className="text-sm text-muted-foreground">Hojas procesadas</p>
              </div>
              <div>
                <p className="text-2xl font-bold">{detectionResult.greenRowsFound}</p>
                <p className="text-sm text-muted-foreground">Filas verdes</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-green-600">
                  {detectionResult.products.length}
                </p>
                <p className="text-sm text-muted-foreground">Productos válidos</p>
              </div>
            </div>

            {detectionResult.products.length > 0 && (
              <div className="mt-4 max-h-60 overflow-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted sticky top-0">
                    <tr>
                      <th className="text-left p-2">ETM</th>
                      <th className="text-left p-2">Model Code</th>
                      <th className="text-right p-2">Cantidad</th>
                      <th className="text-right p-2">Precio</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detectionResult.products.map((product, index) => (
                      <tr key={index} className="border-b">
                        <td className="p-2 font-mono">{product.etm}</td>
                        <td className="p-2">{product.model_code}</td>
                        <td className="p-2 text-right">{product.quantity}</td>
                        <td className="p-2 text-right">
                          ${product.price.toLocaleString('es-MX')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Submit Button */}
      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          onClick={() => router.push('/dashboard/orders')}
          disabled={isSubmitting}
        >
          Cancelar
        </Button>
        <Button
          onClick={handleSubmit}
          disabled={
            !customerName.trim() ||
            !detectionResult ||
            detectionResult.products.length === 0 ||
            isSubmitting
          }
        >
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Creando orden...
            </>
          ) : (
            'Crear Orden'
          )}
        </Button>
      </div>
    </div>
  )
}
