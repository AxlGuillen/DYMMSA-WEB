'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { RotateCcw } from 'lucide-react'
import { FileUploader } from '@/components/quoter/FileUploader'
import { QuotationEditor } from '@/components/quoter/QuotationEditor'
import { useLookupEtms } from '@/hooks/useQuotes'
import { useSaveQuotation } from '@/hooks/useQuotations'
import { extractProductRowsFromExcel } from '@/lib/excel/parser'
import { useQuotationStore } from '@/stores/quotationStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'

type Step = 'upload' | 'editor'

export default function QuoterPage() {
  const router = useRouter()
  const [step, setStep] = useState<Step>('upload')

  const { customer_name, items, setCustomerName, setItems, reset } =
    useQuotationStore()

  const lookupMutation  = useLookupEtms()
  const saveMutation    = useSaveQuotation()

  // Recover draft from localStorage on mount
  useEffect(() => {
    if (items.length > 0) {
      setStep('editor')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleFileSelected = async (file: File) => {
    try {
      const buffer = await file.arrayBuffer()
      const { rows, sheetsProcessed, sheetsWithEtm } =
        extractProductRowsFromExcel(buffer)

      if (rows.length === 0) {
        toast.error('No se encontraron ETMs', {
          description: `Se procesaron ${sheetsProcessed} hojas. Asegúrate de que el archivo tenga una columna "ETM".`,
        })
        return
      }

      toast.info(
        `${rows.length} ETMs encontrados en ${sheetsWithEtm} de ${sheetsProcessed} hojas`
      )

      // Lookup against etm_products
      const etmCodes = rows.map((r) => r.etm)
      const { found } = await lookupMutation.mutateAsync(etmCodes)
      const dbMap = new Map(found.map((p) => [p.etm, p]))

      // Merge: Excel data + DB data → QuotationItemRow[]
      // DB data takes priority for catalog fields; Excel quantity always wins
      const mergedItems: QuotationItemRow[] = rows.map((row) => {
        const db = dbMap.get(row.etm)
        return {
          _id:            crypto.randomUUID(),
          etm:            row.etm,
          description:    db?.description    || row.description,
          description_es: db?.description_es || row.description_es,
          model_code:     db?.model_code     || row.model_code,
          brand:          db?.brand          || row.brand,
          unit_price:     row.price          ?? (db?.price ?? null),
          quantity:       row.quantity,
          _inDb:          !!db,
        }
      })

      setItems(mergedItems)
      setStep('editor')

      const newCount = mergedItems.filter((i) => !i._inDb).length
      const dbCount  = mergedItems.length - newCount

      if (dbCount > 0) {
        toast.success(`${dbCount} producto${dbCount !== 1 ? 's' : ''} encontrado${dbCount !== 1 ? 's' : ''} en el catálogo`)
      }
      if (newCount > 0) {
        toast.warning(
          `${newCount} producto${newCount !== 1 ? 's' : ''} nuevo${newCount !== 1 ? 's' : ''} — completa sus datos antes de guardar`
        )
      }
    } catch (error) {
      toast.error('Error al procesar el archivo', {
        description:
          error instanceof Error ? error.message : 'Error desconocido',
      })
    }
  }

  const handleReset = () => {
    reset()
    setStep('upload')
  }

  const handleSave = async () => {
    try {
      const result = await saveMutation.mutateAsync({ customer_name, items })

      // Auto-learn feedback
      const { added, updated } = result.auto_learn
      const learnMsg = [
        added   > 0 ? `${added} producto${added !== 1 ? 's' : ''} nuevos agregados al catálogo`   : '',
        updated > 0 ? `${updated} producto${updated !== 1 ? 's' : ''} actualizados en el catálogo` : '',
      ].filter(Boolean).join(' · ')

      toast.success('Cotización guardada', {
        description: learnMsg || undefined,
      })

      reset()
      router.push('/dashboard/quotations')
    } catch (error) {
      toast.error('Error al guardar', {
        description: error instanceof Error ? error.message : 'Error desconocido',
      })
    }
  }

  const canSave =
    customer_name.trim().length > 0 &&
    items.length > 0 &&
    !saveMutation.isPending

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Cotizador</h2>
          <p className="text-muted-foreground">
            Sube el Excel del cliente, completa los datos faltantes y genera la cotización.
          </p>
        </div>
        {step === 'editor' && (
          <Button variant="outline" size="sm" onClick={handleReset}>
            <RotateCcw className="h-4 w-4 mr-2" />
            Nueva cotización
          </Button>
        )}
      </div>

      {/* Step: upload */}
      {step === 'upload' && (
        <FileUploader
          onFileSelected={handleFileSelected}
          isLoading={lookupMutation.isPending}
        />
      )}

      {/* Step: editor */}
      {step === 'editor' && (
        <div className="space-y-6">
          {/* Customer name */}
          <div className="max-w-sm space-y-1.5">
            <Label htmlFor="customer_name">
              Nombre del cliente{' '}
              <span className="text-destructive">*</span>
            </Label>
            <Input
              id="customer_name"
              value={customer_name}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Ej: Constructora ABC"
            />
          </div>

          {/* Editable product table */}
          <QuotationEditor />

          {/* Save */}
          <div className="flex justify-end pt-2 border-t">
            <Button
              size="lg"
              disabled={!canSave}
              onClick={handleSave}
            >
              {saveMutation.isPending ? 'Guardando...' : 'Guardar cotización'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
