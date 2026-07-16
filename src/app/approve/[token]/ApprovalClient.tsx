'use client'

import { useMemo, useState } from 'react'
import Image from 'next/image'
import {
  CheckCircle,
  XCircle,
  Package,
  SeparatorHorizontal,
} from '@/components/icons'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
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
import { filterProductItems } from '@/lib/business-rules'
import {
  NO_FILTERS,
  listBrands,
  listSections,
  computeVisibleItemIds,
  deriveItemSections,
  type ApprovalFilters as Filters,
} from '@/lib/approval-filters'
import type { QuotationWithItems, DeliveryTime } from '@/types/database'
import { SummaryTiles } from './SummaryTiles'
import { ApprovalFilters } from './ApprovalFilters'
import { ApprovalDock } from './ApprovalDock'
import { SuccessScreen } from './SuccessScreen'
import { formatMoney } from './format'

const DELIVERY_TIME_LABELS: Record<DeliveryTime, string> = {
  immediate: 'Inmediato',
  '2_3_days': '2 a 3 días',
  '3_5_days': '3 a 5 días',
  '1_week': '1 semana',
  '2_weeks': '2 semanas',
  indefinite: 'Indefinido',
}

interface ItemDecision {
  item_id: string
  is_approved: boolean
}

interface Props {
  quotation: QuotationWithItems
  token: string
}

const dash = <span className="text-muted-foreground">—</span>

// oxlint-disable-next-line react-doctor/no-giant-component -- página pública standalone; se apoya en subcomponentes colocados
export function ApprovalClient({ quotation, token }: Props) {
  const isEditable = quotation.status === 'sent_for_approval'

  // Solo los productos reciben decisión. Los "no lo vendemos" (is_sold===false)
  // se muestran como "No disponible": no cuentan ni suman al total.
  const productItems = filterProductItems(quotation.quotation_items).filter(
    (item) => item.is_sold !== false,
  )

  const [decisions, setDecisions] = useState<ItemDecision[]>(() =>
    productItems.map((item) => ({
      item_id: item.id,
      is_approved: item.is_approved === true, // preserva si retoma
    })),
  )
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [savedApprovedCount, setSavedApprovedCount] = useState(
    () => productItems.filter((item) => item.is_approved === true).length,
  )

  // ── Filtros por marca y proyecto/sección (issue #24) ────────────────
  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  const items = quotation.quotation_items
  const brands = useMemo(() => listBrands(productItems), [productItems])
  const sections = useMemo(() => listSections(items), [items])
  const sectionsMap = useMemo(() => deriveItemSections(items), [items])
  const visibleIds = useMemo(() => computeVisibleItemIds(items, filters), [items, filters])
  // Productos (aprobables) visibles bajo el filtro → para "aprobar visibles".
  const visibleProductIds = useMemo(
    () => productItems.filter((item) => visibleIds.has(item.id)).map((item) => item.id),
    [productItems, visibleIds],
  )
  // Un separador se muestra solo si su sección tiene ≥1 ítem visible.
  const visibleSections = useMemo(() => {
    const set = new Set<string>()
    for (const item of items) {
      if (item.item_type !== 'separator' && visibleIds.has(item.id)) {
        set.add(sectionsMap.get(item.id) ?? '')
      }
    }
    return set
  }, [items, visibleIds, sectionsMap])

  const approvedCount = decisions.filter((d) => d.is_approved).length
  const notApprovedCount = decisions.length - approvedCount

  const approvedTotal = productItems.reduce((sum, item) => {
    const dec = decisions.find((d) => d.item_id === item.id)
    if (dec?.is_approved && item.unit_price != null && item.quantity != null) {
      return sum + item.unit_price * item.quantity
    }
    return sum
  }, 0)

  const toggleDecision = (item_id: string) => {
    setDecisions((prev) =>
      prev.map((d) => (d.item_id === item_id ? { ...d, is_approved: !d.is_approved } : d)),
    )
  }

  // Aprueba solo los productos visibles bajo el filtro activo (contextual).
  const handleApproveVisible = () => {
    const visible = new Set(visibleProductIds)
    setDecisions((prev) =>
      prev.map((d) => (visible.has(d.item_id) ? { ...d, is_approved: true } : d)),
    )
  }

  const approvedIds = () => decisions.filter((d) => d.is_approved).map((d) => d.item_id)

  const postDecisions = async (finalize: boolean) => {
    const res = await fetch(`/api/approve/${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approvedIds: approvedIds(), finalize }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.message || 'Error al guardar')
    }
  }

  const handleSaveProgress = async () => {
    setIsSaving(true)
    try {
      await postDecisions(false)
      setSavedApprovedCount(approvedCount)
      toast.success('Avance guardado', {
        description: 'Puedes cerrar y continuar más tarde con este mismo enlace.',
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al guardar el avance')
    } finally {
      setIsSaving(false)
    }
  }

  const handleFinalize = async () => {
    setConfirmOpen(false)
    setIsSubmitting(true)
    try {
      await postDecisions(true)
      setSubmitted(true)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al enviar decisión')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (submitted) {
    return <SuccessScreen approvedCount={approvedCount} notApprovedCount={notApprovedCount} />
  }

  const alreadyProcessed =
    quotation.status === 'approved' ||
    quotation.status === 'rejected' ||
    quotation.status === 'converted_to_order'
  const approvedBanner =
    quotation.status === 'approved' || quotation.status === 'converted_to_order'

  return (
    <div className="min-h-screen bg-background [background-image:radial-gradient(1100px_540px_at_72%_-8%,rgba(163,3,5,0.07),transparent_58%),radial-gradient(900px_520px_at_6%_4%,rgba(80,80,120,0.08),transparent_55%),radial-gradient(circle,var(--border)_1px,transparent_1px)] [background-size:auto,auto,22px_22px]">
      {/* Header glass sticky */}
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-4">
            <Image
              src="/dymmsa-logo.webp"
              alt="DYMMSA"
              width={120}
              height={48}
              className="object-contain"
              priority
            />
            <div className="hidden h-8 w-px bg-border sm:block" />
            <div className="hidden sm:block">
              <p className="text-sm font-medium leading-tight">Cotización para aprobación</p>
              <p className="text-xs text-muted-foreground">
                Distribuidor autorizado URREA · Morelia, Mich.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-border/70 bg-card/60 px-3 py-1.5 text-xs text-muted-foreground backdrop-blur">
            <span className="size-1.5 animate-pulse rounded-full bg-green-500 shadow-[0_0_8px] shadow-green-500" />
            Documento seguro
          </div>
        </div>
      </header>

      {/* Barra de filtros sticky (solo editable y si hay algo que filtrar) */}
      {isEditable && (brands.length > 1 || sections.length > 1) && (
        <ApprovalFilters
          brands={brands}
          sections={sections}
          filters={filters}
          onChange={setFilters}
          visibleCount={visibleProductIds.length}
          onApproveVisible={handleApproveVisible}
        />
      )}

      <div className="mx-auto max-w-7xl space-y-6 px-4 py-8 pb-32 sm:px-6 lg:px-8">
        <SummaryTiles
          customerName={quotation.customer_name}
          createdAt={quotation.created_at}
          productCount={productItems.length}
          subtotal={quotation.total_amount}
        />

        {alreadyProcessed && (
          <div
            className={`rounded-2xl border-2 p-4 text-center text-sm font-semibold backdrop-blur ${
              approvedBanner
                ? 'border-green-400/60 bg-green-500/10 text-green-700 dark:text-green-400'
                : 'border-red-400/60 bg-red-500/10 text-red-700 dark:text-red-400'
            }`}
          >
            {approvedBanner ? '✓ Esta cotización ya fue aprobada' : '✗ Esta cotización fue rechazada'}
          </div>
        )}

        {isEditable && savedApprovedCount > 0 && (
          <div className="rounded-2xl border-2 border-blue-300/60 bg-blue-500/10 p-4 text-center text-sm font-medium text-blue-700 backdrop-blur dark:text-blue-300">
            Tienes avance guardado: {savedApprovedCount} de {productItems.length} producto
            {productItems.length !== 1 ? 's' : ''} aprobado{savedApprovedCount !== 1 ? 's' : ''}.
            Continúa donde quedaste y envía cuando termines.
          </div>
        )}

        {/* Tabla de productos */}
        <div className="overflow-hidden rounded-2xl border border-border/60 bg-card/40 backdrop-blur-xl">
          <div className="flex items-center gap-2.5 border-b border-border/60 px-5 py-4">
            <Package className="size-5 text-muted-foreground" />
            <span className="text-base font-semibold">Productos de la cotización</span>
            <span className="rounded-md border border-border/70 px-2 py-0.5 font-mono text-xs text-muted-foreground">
              {productItems.length}
            </span>
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-border/60 hover:bg-transparent">
                  <TableHead className="font-mono text-[10.5px] uppercase tracking-wide">ETM</TableHead>
                  <TableHead className="font-mono text-[10.5px] uppercase tracking-wide">Descripción</TableHead>
                  <TableHead className="font-mono text-[10.5px] uppercase tracking-wide">Desc. DYMMSA</TableHead>
                  <TableHead className="font-mono text-[10.5px] uppercase tracking-wide">Código</TableHead>
                  <TableHead className="font-mono text-[10.5px] uppercase tracking-wide">Marca</TableHead>
                  <TableHead className="text-right font-mono text-[10.5px] uppercase tracking-wide">Precio unit.</TableHead>
                  <TableHead className="text-right font-mono text-[10.5px] uppercase tracking-wide">Cant.</TableHead>
                  <TableHead className="text-right font-mono text-[10.5px] uppercase tracking-wide">Subtotal</TableHead>
                  <TableHead className="whitespace-nowrap font-mono text-[10.5px] uppercase tracking-wide">Entrega</TableHead>
                  <TableHead className="min-w-[140px] text-center font-mono text-[10.5px] uppercase tracking-wide">Aprobación</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {quotation.quotation_items.map((item) => {
                  // Separador → fila de sección. Solo si su sección tiene ≥1 ítem
                  // visible bajo el filtro (evita secciones vacías al filtrar).
                  if (item.item_type === 'separator') {
                    const label = item.section_label?.trim() || 'General'
                    if (!visibleSections.has(label)) return null
                    return (
                      <TableRow key={item.id} className="border-dashed border-border/60 bg-muted/30 hover:bg-muted/30">
                        <TableCell colSpan={10} className="px-4 py-2">
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <SeparatorHorizontal className="size-3.5 shrink-0" />
                            <span className="font-medium">{item.section_label || 'Sección'}</span>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  }

                  // Filtro por marca/proyecto: oculta ítems que no pasan.
                  if (!visibleIds.has(item.id)) return null

                  // "No lo vendemos" → fila informativa read-only
                  if (item.is_sold === false) {
                    return (
                      <TableRow key={item.id} className="border-border/40 bg-muted/40 text-muted-foreground">
                        <TableCell className="font-mono text-xs">{item.etm || '—'}</TableCell>
                        <TableCell className="max-w-52">
                          <span className="block truncate" title={item.description || item.description_es || ''}>
                            {item.description || item.description_es || '—'}
                          </span>
                        </TableCell>
                        <TableCell className="max-w-52">
                          <span className="block truncate" title={item.dymmsa_description || ''}>
                            {item.dymmsa_description || '—'}
                          </span>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{item.model_code || '—'}</TableCell>
                        <TableCell className="text-sm">{item.brand || '—'}</TableCell>
                        <TableCell colSpan={4} className="text-center text-xs italic">No disponible</TableCell>
                        <TableCell className="text-center">
                          <Badge variant="outline" className="text-xs text-muted-foreground">No disponible</Badge>
                        </TableCell>
                      </TableRow>
                    )
                  }

                  const dec = decisions.find((d) => d.item_id === item.id)
                  const approved = dec?.is_approved ?? false
                  const subtotal =
                    item.unit_price != null && item.quantity != null
                      ? item.unit_price * item.quantity
                      : null

                  return (
                    <TableRow
                      key={item.id}
                      className={`border-border/40 transition-colors ${
                        isEditable && approved
                          ? 'bg-green-500/10 hover:bg-green-500/15'
                          : 'hover:bg-muted/40'
                      }`}
                    >
                      <TableCell className="font-mono text-xs font-semibold text-muted-foreground">
                        {item.etm || '—'}
                      </TableCell>
                      <TableCell className="max-w-52">
                        {item.description ? (
                          <span className="block truncate font-medium" title={item.description}>{item.description}</span>
                        ) : item.description_es ? (
                          <span className="block truncate italic text-muted-foreground" title={item.description_es}>{item.description_es}</span>
                        ) : dash}
                      </TableCell>
                      <TableCell className="max-w-52">
                        {item.dymmsa_description ? (
                          <span className="block truncate" title={item.dymmsa_description}>{item.dymmsa_description}</span>
                        ) : dash}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {item.model_code || dash}
                      </TableCell>
                      <TableCell className="text-sm">
                        {item.brand ? <span className="font-medium">{item.brand}</span> : dash}
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums">
                        {item.unit_price != null ? formatMoney(item.unit_price) : dash}
                      </TableCell>
                      <TableCell className="text-right text-sm font-medium tabular-nums">
                        {item.quantity ?? dash}
                      </TableCell>
                      <TableCell className="text-right text-sm font-semibold tabular-nums">
                        {subtotal != null ? formatMoney(subtotal) : dash}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm">
                        {item.delivery_time
                          ? DELIVERY_TIME_LABELS[item.delivery_time as DeliveryTime] ?? item.delivery_time
                          : dash}
                      </TableCell>
                      <TableCell className="text-center">
                        {isEditable ? (
                          <Button
                            size="sm"
                            variant={approved ? 'default' : 'outline'}
                            className={`h-8 rounded-lg px-3 text-xs font-semibold ${
                              approved ? 'bg-green-600 border-green-600 hover:bg-green-700' : ''
                            }`}
                            onClick={() => toggleDecision(item.id)}
                          >
                            <CheckCircle className="mr-1.5 size-3.5" />
                            {approved ? 'Aprobado' : 'Aprobar'}
                          </Button>
                        ) : item.is_approved === true ? (
                          <Badge className="border-green-300 bg-green-100 text-green-800 dark:border-green-700 dark:bg-green-900/30 dark:text-green-400">
                            <CheckCircle className="mr-1 size-3" /> Aprobado
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground">
                            <XCircle className="mr-1 size-3" /> No aprobado
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </div>

        {/* Fin del documento */}
        <div className="rounded-2xl border border-border/60 bg-card/40 p-8 text-center backdrop-blur-xl">
          <Image src="/dymmsa-logo.webp" alt="DYMMSA" width={110} height={44} className="mx-auto object-contain opacity-60" />
          <p className="mt-3 text-sm font-medium text-muted-foreground">Has llegado al final de la cotización</p>
          <p className="mt-1 text-xs text-muted-foreground/70">
            DYMMSA · Distribuidor autorizado URREA · Morelia, Michoacán · México
          </p>
        </div>
      </div>

      {/* Dock sticky de acciones */}
      {isEditable && (
        <ApprovalDock
          approvedCount={approvedCount}
          totalCount={productItems.length}
          approvedTotal={approvedTotal}
          isSaving={isSaving}
          isSubmitting={isSubmitting}
          onSave={handleSaveProgress}
          onSend={() => setConfirmOpen(true)}
        />
      )}

      {/* Confirmación de envío definitivo */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Enviar tu aprobación?</AlertDialogTitle>
            <AlertDialogDescription>
              Vas a aprobar <strong>{approvedCount}</strong> producto{approvedCount !== 1 ? 's' : ''}
              {approvedTotal > 0 && (
                <> por un total de <strong>{formatMoney(approvedTotal)}</strong></>
              )}
              . Esto finaliza tu revisión y no podrás volver a cambiarla desde este enlace.
              Si aún no terminas, usa «Guardar avance».
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleFinalize}>Sí, enviar aprobación</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
