'use client'

import { useState } from 'react'
import { FileUploader } from '@/components/quoter/FileUploader'
import { QuotePreview } from '@/components/quoter/QuotePreview'
import { useLookupEtms } from '@/hooks/useQuotes'
import { extractEtmCodesFromExcel } from '@/lib/excel/parser'
import { generateQuoteExcel, downloadExcel } from '@/lib/excel/generator'
import type { EtmProduct } from '@/types/database'
import { toast } from 'sonner'

type Step = 'upload' | 'preview'

export default function QuoterPage() {
  const [step, setStep] = useState<Step>('upload')
  const [filename, setFilename] = useState('')
  const [matchedProducts, setMatchedProducts] = useState<EtmProduct[]>([])
  const [unmatchedEtms, setUnmatchedEtms] = useState<string[]>([])
  const [totalRequested, setTotalRequested] = useState(0)

  const lookupMutation = useLookupEtms()

  const handleFileSelected = async (file: File) => {
    setFilename(file.name)

    try {
      // Parsear Excel y extraer ETMs
      const buffer = await file.arrayBuffer()
      const { etmCodes, sheetsProcessed, sheetsWithEtm } =
        extractEtmCodesFromExcel(buffer)

      setTotalRequested(etmCodes.length)

      if (etmCodes.length === 0) {
        toast.error('No se encontraron codigos ETM', {
          description: `Se procesaron ${sheetsProcessed} hojas. Asegurate de que el archivo tenga una columna llamada "ETM".`,
        })
        return
      }

      // Mostrar info de procesamiento
      toast.info(
        `Se encontraron ${etmCodes.length} ETMs unicos en ${sheetsWithEtm} de ${sheetsProcessed} hojas`
      )

      // Buscar en la base de datos
      const result = await lookupMutation.mutateAsync(etmCodes)

      setMatchedProducts(result.found)
      setUnmatchedEtms(result.notFound)
      setStep('preview')

      // Notificar resultados
      if (result.notFound.length > 0) {
        toast.warning(
          `${result.notFound.length} ETMs no encontrados en la base de datos`
        )
      }
    } catch (error) {
      console.error('Error processing file:', error)
      toast.error('Error al procesar el archivo', {
        description:
          error instanceof Error ? error.message : 'Error desconocido',
      })
    }
  }

  const handleDownload = () => {
    try {
      // Generar y descargar Excel
      const blob = generateQuoteExcel(matchedProducts)
      downloadExcel(blob, filename)

      toast.success('Cotizacion descargada')
    } catch (error) {
      console.error('Download error:', error)
      toast.error('Error al generar la cotizacion')
    }
  }

  const handleReset = () => {
    setStep('upload')
    setFilename('')
    setMatchedProducts([])
    setUnmatchedEtms([])
    setTotalRequested(0)
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Matcher ETM {"->"} URREA</h2>
        <p className="text-muted-foreground">
          Sube un archivo Excel con codigos ETM para obtener los codigos Urrea y agilizar tu cotizacion.
        </p>
      </div>

      {step === 'upload' && (
        <FileUploader
          onFileSelected={handleFileSelected}
          isLoading={lookupMutation.isPending}
        />
      )}

      {step === 'preview' && (
        <QuotePreview
          filename={filename}
          totalRequested={totalRequested}
          matchedProducts={matchedProducts}
          unmatchedEtms={unmatchedEtms}
          onDownload={handleDownload}
          onReset={handleReset}
        />
      )}
    </div>
  )
}
