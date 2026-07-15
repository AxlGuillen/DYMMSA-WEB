'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { RotateCcw, Check, Loader2 } from '@/components/icons'
import { FileUploader } from '@/components/quoter/FileUploader'
import { QuotationEditor } from '@/components/quoter/QuotationEditor'
import { useLookupEtms } from '@/hooks/useQuotes'
import { useSaveQuotation, ApiError } from '@/hooks/useQuotations'
import { extractProductRowsFromExcel } from '@/lib/excel/parser'
import { useQuotationStore } from '@/stores/quotationStore'
import {
  getBlockingIssues,
  getMissingHeaderFields,
  headerFieldsMessage,
  hasNoProducts,
  type HeaderField,
} from '@/lib/quotation-validation'
import { scrollToRow, focusById } from '@/lib/dom-helpers'
import type { QuotationItemRow } from '@/types/database'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'

type Step = 'upload' | 'editor'

export default function QuoterPage() {
  const { push } = useRouter()
  const [step, setStep] = useState<Step>('upload')
  /** _id de filas con error pre-flight o reportadas por el backend (offendingEtm). */
  const [errorItemIds, setErrorItemIds] = useState<ReadonlySet<string>>(new Set())
  /** Campos de encabezado (nombre/cliente) faltantes, para resaltarlos en rojo. */
  const [headerErrors, setHeaderErrors] = useState<ReadonlySet<HeaderField>>(new Set())

  /** Limpia el resaltado de un campo de encabezado cuando el usuario lo edita. */
  const clearHeaderError = (field: HeaderField) => {
    setHeaderErrors((prev) => {
      if (!prev.has(field)) return prev
      const next = new Set(prev)
      next.delete(field)
      return next
    })
  }

  const { name, customer_name, items, setName, setCustomerName, setItems, reset,
    mergeCatalogDescriptions } = useQuotationStore()

  const lookupMutation  = useLookupEtms()
  const saveMutation    = useSaveQuotation()

  // Recover draft from localStorage on mount
  useEffect(() => {
    if (items.length > 0) {
      // oxlint-disable-next-line react-doctor/no-initialize-state -- intentional pattern; structural refactor tracked separately
      setStep('editor')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // oxlint-disable-line react-doctor/exhaustive-deps -- intentional effect; refactor tracked separately

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

      // Replace DYMMSA-TEMP-* placeholders (from ETM = "new") with real sequential codes
      const tempRows = rows.filter((r) => r.etm.startsWith('DYMMSA-TEMP-'))
      if (tempRows.length > 0) {
        try {
          const resp = await fetch('/api/products/next-dymmsa-code')
          const { next } = await resp.json()
          tempRows.forEach((row, i) => { row.etm = `DYMMSA-${next + i}` })
        } catch {
          // On error keep the TEMP ids; user can edit manually
        }
      }

      toast.info(
        `${rows.length} ETM${rows.length !== 1 ? 's' : ''} encontrado${rows.length !== 1 ? 's' : ''} en ${sheetsWithEtm} de ${sheetsProcessed} hojas${tempRows.length > 0 ? ` · ${tempRows.length} sin ETM asignado como DYMMSA-#` : ''}`
      )

      // Lookup against etm_products (deduplicate ETMs for the API call)
      const uniqueEtms = [...new Set(rows.map((r) => r.etm))]
      // modelCodes del Excel: resuelven descripción de catálogo también en
      // filas que aún no existen en etm_products
      const excelModelCodes = [...new Set(rows.map((r) => r.model_code).filter(Boolean))]
      const { found, catalogDescriptions } = await lookupMutation.mutateAsync({
        etmCodes: uniqueEtms,
        modelCodes: excelModelCodes,
      })
      mergeCatalogDescriptions(catalogDescriptions ?? {})
      const dbMap = new Map(found.map((p) => [p.etm, p]))

      // Merge: Excel data + DB data → QuotationItemRow[]
      // DB data takes priority for catalog fields; Excel quantity always wins
      const mergedItems: QuotationItemRow[] = rows.map((row) => {
        const db = dbMap.get(row.etm)
        return {
          _id:            crypto.randomUUID(),
          item_type:      'product',
          section_label:  '',
          etm:            row.etm,
          description:    db?.description    || row.description,
          description_es: db?.description_es || row.description_es,
          model_code:     db?.model_code     || row.model_code,
          brand:          db?.brand          || row.brand,
          unit_price:     row.price          ?? (db?.price ?? null),
          quantity:       row.quantity,
          delivery_time:  'immediate',
          _inDb:          !!db,
          is_sold:        db?.is_sold ?? null, // hereda el flag del catálogo; null si no está en catálogo
          dymmsa_description: db?.dymmsa_description ?? '', // hereda la curada DYMMSA (vacía si tiene match de catálogo URREA)
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
    // ── 0. Encabezado: nombre de la cotización y del cliente (issue #26) ────
    const missingHeader = getMissingHeaderFields(name, customer_name)
    if (missingHeader.length > 0) {
      setHeaderErrors(new Set(missingHeader))
      toast.error(headerFieldsMessage(missingHeader))
      focusById(missingHeader[0] === 'name' ? 'quotation_name' : 'customer_name')
      return
    }
    setHeaderErrors(new Set())

    // ── 1. Debe haber al menos un producto ─────────────────────────────────
    if (hasNoProducts(items)) {
      toast.error('Agrega al menos un producto a la cotización.')
      return
    }

    // ── 2. Pre-flight: atrapar errores conocidos antes de pegar al servidor ─
    const blocking = getBlockingIssues(items)
    if (blocking.length > 0) {
      const first = blocking[0]
      setErrorItemIds(new Set(blocking.map((i) => i.itemId)))
      toast.error(first.message, {
        description:
          blocking.length > 1
            ? `Y ${blocking.length - 1} problema${blocking.length - 1 !== 1 ? 's' : ''} más.`
            : undefined,
      })
      scrollToRow(first.itemId)
      return
    }
    setErrorItemIds(new Set())

    // ── 3. Request al backend ───────────────────────────────────────────
    try {
      const result = await saveMutation.mutateAsync({ name, customer_name, items })

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
      // Abre la cotización recién creada; si por algo no vino el id, cae a la lista.
      push(result.quotation_id
        ? `/dashboard/quotations/${result.quotation_id}`
        : '/dashboard/quotations')
    } catch (error) {
      handleSaveError(error)
    }
  }

  /** Manejo centralizado de errores: 401, red, validación con ETM, fallback. */
  const handleSaveError = (error: unknown) => {
    if (error instanceof ApiError) {
      if (error.code === 'AUTH_EXPIRED') {
        toast.error(error.message)
        push('/login')
        return
      }
      // Resaltar el ítem ofensor reportado por el backend.
      if (error.offendingEtm) {
        const offending = items.find((i) => i.etm === error.offendingEtm)
        if (offending) {
          setErrorItemIds(new Set([offending._id]))
          scrollToRow(offending._id)
        }
      }
      toast.error(error.message)
      return
    }
    toast.error('Error al guardar', {
      description: error instanceof Error ? error.message : 'Error desconocido',
    })
  }

  // Habilitado salvo mientras guarda: los requisitos (nombre/cliente/productos)
  // ya no deshabilitan en silencio — se avisan en handleSave (issue #26).
  const canSave = !saveMutation.isPending

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Cotizador</h2>
          <p className="text-muted-foreground">
            Sube el Excel del cliente, completa los datos faltantes y genera la cotización.
          </p>
        </div>
        {step === 'editor' && (
          <Button variant="outline" size="sm" onClick={handleReset}>
            <RotateCcw className="size-4 mr-2" />
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
          {/* Quotation name + Customer name */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
            <div className="space-y-1.5">
              <Label htmlFor="quotation_name">
                Nombre de la cotización{' '}
                <span className="text-destructive">*</span>
              </Label>
              <Input
                id="quotation_name"
                value={name}
                aria-invalid={headerErrors.has('name')}
                onChange={(e) => {
                  setName(e.target.value)
                  clearHeaderError('name')
                }}
                placeholder="Ej: Obra Norte Enero 2026"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="customer_name">
                Nombre del cliente{' '}
                <span className="text-destructive">*</span>
              </Label>
              <Input
                id="customer_name"
                value={customer_name}
                aria-invalid={headerErrors.has('customer')}
                onChange={(e) => {
                  setCustomerName(e.target.value)
                  clearHeaderError('customer')
                }}
                placeholder="Ej: Constructora ABC"
              />
            </div>
          </div>

          {/* Editable product table */}
          <QuotationEditor errorItemIds={errorItemIds} />

          {/* Save */}
          <div className="flex justify-end pt-2 border-t">
            <Button
              size="lg"
              disabled={!canSave}
              onClick={handleSave}
            >
              {saveMutation.isPending ? (
                <><Loader2 className="mr-2 size-4 animate-spin" />Guardando...</>
              ) : (
                <><Check className="mr-2 size-4" />Guardar cotización</>
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
