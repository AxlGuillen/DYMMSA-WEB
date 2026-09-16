'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  ArrowLeft,
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Loader2,
  Package,
  RefreshCw,
  Scissors,
  ShoppingCart,
  Wrench,
} from '@/components/icons'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useCurrency } from '@/hooks/useCurrency'
import { useVisibleColumns, type TableColumn } from '@/hooks/useVisibleColumns'
import { ColumnPicker } from '@/components/ColumnPicker'
import { TourButton } from '@/components/tours/TourButton'
import { usePurchasePlan, useSavePurchaseDecisions, type PurchasePlanResponse } from '@/hooks/usePurchasePlan'
import { useUpdateSettings } from '@/hooks/useSettings'
import {
  applyChoice,
  summarizePlanDecisions,
  SETTING_THRESHOLD_MONEY,
  SETTING_THRESHOLD_PCT,
  type PurchaseChoice,
  type PurchaseGroupPlan,
  type PurchaseThresholds,
  type PurchasePlanTotals,
} from '@/lib/purchase-plan'
import type { LocalPurchaseRow } from '@/lib/excel/generator'

interface PurchasePlannerProps {
  data: PurchasePlanResponse
}

/** Rebuilds the choice behind a saved decision, to pre-select it. */
function savedChoice(group: PurchaseGroupPlan): PurchaseChoice | null {
  const d = group.decision
  if (!d) return null
  if (d.qty_retail === 0) return 'wholesale'
  if (d.packages_wholesale === 0) return 'retail'
  return 'mixed'
}

const RECOMMENDATION_BADGE: Record<
  string,
  { label: string; className: string }
> = {
  wholesale_exact: { label: 'Exacto', className: 'bg-green-500/15 text-green-700 dark:text-green-400' },
  wholesale_rounded: { label: 'Mayoreo', className: 'bg-green-500/15 text-green-700 dark:text-green-400' },
  mixed: { label: 'Mixto', className: 'bg-blue-500/15 text-blue-700 dark:text-blue-400' },
  review: { label: 'Revisar', className: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' },
}

/** Subtle per-decision background: badge colors, toned down not to fight the text. */
const CHOICE_ROW_CLASS: Record<PurchaseChoice | 'undecided', string> = {
  wholesale: 'bg-green-500/5 border-green-500/30',
  mixed: 'bg-blue-500/5 border-blue-500/30',
  retail: 'bg-orange-500/5 border-orange-500/30',
  undecided: 'bg-amber-500/10 border-amber-500/40',
}

/** Selector value when no brand filter is applied (#53). */
const ALL_BRANDS = '__all__'

// Flat-view columns (#18). Código is the group identity.
const FLAT_COLUMNS: readonly TableColumn[] = [
  { id: 'section', label: 'Sección' },
  { id: 'etm', label: 'ETM' },
  { id: 'model_code', label: 'Código', hideable: false },
  { id: 'brand', label: 'Marca' },
  { id: 'qty_to_order', label: 'A pedir' },
  { id: 'unit_price', label: 'Precio' },
  { id: 'bucket', label: 'Bucket' },
]

export function PurchasePlanner({ data }: PurchasePlannerProps) {
  const { order, plan } = data
  const { push } = useRouter()
  const fmt = useCurrency()
  const saveDecisions = useSavePurchaseDecisions(order.id)

  /** Explicit user overrides only; the default is derived at render time. */
  const [overrides, setOverrides] = useState<Record<string, PurchaseChoice>>({})
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [flatView, setFlatView] = useState(false)
  const [brandFilter, setBrandFilter] = useState<string>(ALL_BRANDS)
  const [isDownloadingUrrea, setIsDownloadingUrrea] = useState(false)
  const [isDownloadingLocal, setIsDownloadingLocal] = useState(false)

  const mathGroups = plan.groups.filter((g) => g.bucket !== 'local')
  const localGroups = plan.groups.filter((g) => g.bucket === 'local')
  const isReadOnly = ['completed', 'cancelled'].includes(order.status)

  /** Brand filter (#53): VISUAL ONLY — saving and the Excels run over the full lists. */
  // `filter(Boolean)` is defensive: a `SelectItem` with value="" makes Radix throw
  // and takes the page down.
  const brandOptions = [...new Set(plan.groups.map((g) => g.brand))].filter(Boolean).sort()
  const visibleMathGroups =
    brandFilter === ALL_BRANDS ? mathGroups : mathGroups.filter((g) => g.brand === brandFilter)
  const visibleLocalGroups =
    brandFilter === ALL_BRANDS ? localGroups : localGroups.filter((g) => g.brand === brandFilter)
  const visibleGroups =
    brandFilter === ALL_BRANDS ? plan.groups : plan.groups.filter((g) => g.brand === brandFilter)

  const effectiveChoice = (group: PurchaseGroupPlan): PurchaseChoice | null =>
    overrides[group.key] ?? savedChoice(group) ?? group.recommendation?.suggested ?? null

  const pendingCount = mathGroups.filter((g) => !effectiveChoice(g)).length

  // Covers unsaved overrides too, so moving a decision is felt instantly.
  const totals = summarizePlanDecisions(plan.groups, effectiveChoice)

  const toggleExpanded = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  /** Decision payload built from the effective on-screen choices. */
  const buildDecisions = () =>
    mathGroups.map((group) => {
      const split = applyChoice(group.math!, effectiveChoice(group)!)
      return {
        model_code: group.modelCode,
        brand: group.brand,
        std_snapshot: group.math!.std,
        needed_qty: group.needed,
        packages_wholesale: split.packagesWholesale,
        qty_retail: split.qtyRetail,
      }
    })

  /** Dirty = on-screen choice differs from what is persisted (stale ones included). */
  const isDirty = mathGroups.some((group) => {
    const choice = effectiveChoice(group)
    if (!choice) return true
    const split = applyChoice(group.math!, choice)
    const saved = group.decision
    return (
      !saved ||
      saved.isStale ||
      saved.packages_wholesale !== split.packagesWholesale ||
      saved.qty_retail !== split.qtyRetail
    )
  })

  const missingDecisionsMessage = () =>
    `Falta decidir ${pendingCount} grupo${pendingCount !== 1 ? 's' : ''} marcado${pendingCount !== 1 ? 's' : ''} como "Revisar".`

  const handleSave = async () => {
    if (pendingCount > 0) {
      toast.error(missingDecisionsMessage())
      return
    }
    try {
      await saveDecisions.mutateAsync(buildDecisions())
      toast.success('Decisiones de compra guardadas')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al guardar las decisiones')
    }
  }

  /** Excel URREA mirrors what is SAVED (ADR-018): persist first, then generate. */
  // On a closed order the file comes ONLY from persisted decisions.
  const buildUrreaRows = () =>
    isReadOnly
      ? mathGroups.flatMap((group) => {
          const saved = group.decision
          return saved && saved.packages_wholesale > 0
            ? [{
                code: saved.model_code,
                pieces: saved.packages_wholesale * saved.std_snapshot,
              }]
            : []
        })
      : mathGroups.flatMap((group) => {
          const { packagesWholesale } = applyChoice(group.math!, effectiveChoice(group)!)
          return packagesWholesale > 0
            ? [{ code: group.modelCode, pieces: packagesWholesale * group.math!.std }]
            : []
        })

  const handleDownloadUrrea = async () => {
    if (pendingCount > 0) {
      toast.error(missingDecisionsMessage())
      return
    }
    const rows = buildUrreaRows()
    if (rows.length === 0) {
      toast.info('Ninguna decisión manda piezas a URREA (todo quedó en menudeo)')
      return
    }

    setIsDownloadingUrrea(true)
    try {
      if (isDirty && !isReadOnly) {
        await saveDecisions.mutateAsync(buildDecisions())
      }
      // Lazy: xlsx/jszip only download when the order is actually generated.
      const { generateUrreaOrderExcel, downloadUrreaOrder } = await import('@/lib/excel/generator')
      const blob = await generateUrreaOrderExcel(rows)
      downloadUrreaOrder(blob, order.customer_name)
      toast.success(
        `Pedido URREA descargado (${rows.length} productos)${isDirty ? ' · decisiones guardadas' : ''}`,
      )
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al generar el pedido URREA')
    } finally {
      setIsDownloadingUrrea(false)
    }
  }

  /** Tab-separated code+pieces for URREA's legacy Excel (#64). */
  const handleCopyUrrea = async () => {
    if (pendingCount > 0) {
      toast.error(missingDecisionsMessage())
      return
    }
    const rows = buildUrreaRows()
    if (rows.length === 0) {
      toast.info('Ninguna decisión manda piezas a URREA (todo quedó en menudeo)')
      return
    }
    try {
      // Same contract as the download (ADR-018): copied text mirrors what is saved.
      if (isDirty && !isReadOnly) {
        await saveDecisions.mutateAsync(buildDecisions())
      }
      await navigator.clipboard.writeText(rows.map((row) => `${row.code}\t${row.pieces}`).join('\n'))
      toast.success(`Copiado para Excel: ${rows.length} códigos con su cantidad`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo copiar al portapapeles')
    }
  }

  const handleExportLocal = async () => {
    const rows: LocalPurchaseRow[] = []
    for (const group of mathGroups) {
      const choice = effectiveChoice(group)
      if (!choice) continue
      const { qtyRetail } = applyChoice(group.math!, choice)
      if (qtyRetail > 0) {
        rows.push({
          code: group.modelCode,
          brand: group.brand,
          description: group.catalogDescription ?? group.lines[0]?.description ?? '',
          etm: group.lines[0]?.etm ?? '',
          quantity: qtyRetail,
          unitPrice: group.unitPrice,
          origin: 'resto menudeo',
        })
      }
    }
    for (const group of localGroups) {
      rows.push({
        code: group.modelCode || group.lines[0]?.modelCodeRaw || '',
        brand: group.brand,
        description: group.lines[0]?.description ?? '',
        etm: group.lines[0]?.etm ?? '',
        quantity: group.needed,
        unitPrice: group.unitPrice,
        origin: 'sin catálogo',
      })
    }
    if (rows.length === 0) {
      toast.info('No hay nada para compra local')
      return
    }
    setIsDownloadingLocal(true)
    try {
      // Lazy: xlsx only downloads when the local-purchase list is exported.
      const { generateLocalPurchaseExcel, downloadLocalPurchaseExcel } = await import('@/lib/excel/generator')
      downloadLocalPurchaseExcel(generateLocalPurchaseExcel(rows), order.customer_name)
      toast.success(`Lista de compra local descargada (${rows.length} filas)`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo exportar la lista de compra local')
    } finally {
      setIsDownloadingLocal(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-4">
        <Button
          variant="ghost"
          size="icon"
          className="mt-0.5 shrink-0"
          onClick={() => push(`/dashboard/orders/${order.id}`)}
        >
          <ArrowLeft className="size-5" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">Planificar compra</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {order.name || order.customer_name} · mayoreo (URREA) vs menudeo (local) según STD
          </p>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <Badge variant="secondary" className="gap-1">
              <Package className="size-3" /> {plan.summary.urrea} URREA
            </Badge>
            {plan.summary.noData > 0 && (
              <Badge variant="secondary" className="gap-1">
                <AlertTriangle className="size-3" /> {plan.summary.noData} sin precio
              </Badge>
            )}
            <Badge variant="secondary" className="gap-1">
              <ShoppingCart className="size-3" /> {plan.summary.local} sin catálogo
            </Badge>
            {plan.summary.stale > 0 && (
              <Badge className="gap-1 bg-amber-500/15 text-amber-700 dark:text-amber-400">
                <RefreshCw className="size-3" /> {plan.summary.stale} desactualizada
                {plan.summary.stale !== 1 ? 's' : ''}
              </Badge>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <TourButton tour="purchase-planner" />
          {brandOptions.length > 1 && (
            <Select value={brandFilter} onValueChange={setBrandFilter}>
              <SelectTrigger size="sm" className="w-auto min-w-[150px]">
                <SelectValue placeholder="Todas las marcas" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_BRANDS}>Todas las marcas</SelectItem>
                {brandOptions.map((b) => (
                  <SelectItem key={b} value={b}>{b}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <ThresholdsPopover thresholds={plan.thresholds} orderId={order.id} groups={plan.groups} />
          {flatView && <ColumnPicker tableId="purchase-planner-flat" columns={FLAT_COLUMNS} />}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setFlatView((v) => !v)}
            data-tour="plan-view-toggle"
          >
            {flatView ? 'Vista agrupada' : 'Vista plana'}
          </Button>
        </div>
      </div>

      <PlanOverview totals={totals} fmt={fmt} />

      {plan.orphanDecisions.length > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <AlertTriangle className="size-4 mt-0.5 shrink-0 text-amber-600" />
          <span>
            Hay {plan.orphanDecisions.length} decisión
            {plan.orphanDecisions.length !== 1 ? 'es' : ''} de productos que ya no están en la
            orden ({plan.orphanDecisions.map((d) => d.model_code).join(', ')}). Se limpian al
            guardar.
          </span>
        </div>
      )}

      {flatView ? (
        <FlatLinesTable groups={visibleGroups} fmt={fmt} />
      ) : (
        <>
          <Card data-tour="plan-groups">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Package className="size-4" />
                Candidatos a pedido URREA ({visibleMathGroups.length}
                {brandFilter !== ALL_BRANDS && ` de ${mathGroups.length}`})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {visibleMathGroups.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  {mathGroups.length === 0
                    ? 'Ningún producto a pedir cruza con el catálogo URREA.'
                    : `Ningún candidato de la marca ${brandFilter}.`}
                </p>
              )}
              {visibleMathGroups.map((group) => (
                <GroupRow
                  key={group.key}
                  group={group}
                  choice={effectiveChoice(group)}
                  onChoice={(choice) =>
                    setOverrides((prev) => ({ ...prev, [group.key]: choice }))
                  }
                  expanded={expanded.has(group.key)}
                  onToggleExpanded={() => toggleExpanded(group.key)}
                  fmt={fmt}
                  disabled={isReadOnly}
                />
              ))}
            </CardContent>
          </Card>

          <Card data-tour="plan-local">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ShoppingCart className="size-4" />
                Compra local — sin catálogo URREA ({visibleLocalGroups.length}
                {brandFilter !== ALL_BRANDS && ` de ${localGroups.length}`})
                {/* DYMMSA parts are not bought: they get manufactured by cutting material. */}
                {localGroups.some((g) => g.brand === 'DYMMSA') && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto"
                    onClick={() => push(`/dashboard/orders/${order.id}/cutting`)}
                  >
                    <Scissors className="mr-2 size-4" />
                    Planificar corte
                  </Button>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {visibleLocalGroups.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {localGroups.length === 0
                    ? 'Todos los productos a pedir están en el catálogo URREA.'
                    : `Nada de compra local para la marca ${brandFilter}.`}
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Código</TableHead>
                      <TableHead>Marca</TableHead>
                      <TableHead>Descripción</TableHead>
                      <TableHead className="text-right">Cantidad</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleLocalGroups.map((group) => (
                      <TableRow key={group.key}>
                        <TableCell className="font-mono text-sm">
                          {group.modelCode || group.lines[0]?.modelCodeRaw || '—'}
                        </TableCell>
                        <TableCell>{group.brand}</TableCell>
                        <TableCell className="max-w-md truncate">
                          {group.lines[0]?.description || '—'}
                        </TableCell>
                        <TableCell className="text-right">{group.needed}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* `sticky`, not `fixed`: it must live INSIDE the content column so the
          sidebar width is respected. Negative margins make it full-bleed. */}
      <div className="sticky bottom-0 z-30 -mx-4 -mb-6 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:-mx-8 md:-mb-8">
        <div className="flex items-center justify-between gap-4 px-4 py-3 md:px-8">
          <p className="text-sm text-muted-foreground">
            {mathGroups.length - pendingCount} de {mathGroups.length} grupos decididos
            {pendingCount > 0 && (
              <span className="text-amber-600"> · {pendingCount} por revisar</span>
            )}
          </p>
          <div className="flex items-center gap-2" data-tour="plan-actions">
            <Button
              variant="outline"
              onClick={handleDownloadUrrea}
              disabled={isDownloadingUrrea || saveDecisions.isPending || mathGroups.length === 0}
              title="Formato .xlsm de pedido a URREA (piezas en múltiplos de STD)"
            >
              {isDownloadingUrrea ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Download className="mr-2 size-4" />
              )}
              Pedido URREA (mayoreo)
            </Button>
            <Button
              variant="outline"
              onClick={handleCopyUrrea}
              disabled={saveDecisions.isPending || mathGroups.length === 0}
              title="Copia código y cantidad separados por tabulador — pégalo en el Excel de URREA y cae en dos columnas"
            >
              <Copy className="mr-2 size-4" />
              Copiar para Excel
            </Button>
            <Button
              variant="outline"
              onClick={handleExportLocal}
              disabled={isDownloadingLocal}
              title="Excel con los restos a menudeo y lo que no está en el catálogo"
            >
              {isDownloadingLocal ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Download className="mr-2 size-4" />
              )}
              Compra local (menudeo)
            </Button>
            <Button
              onClick={handleSave}
              disabled={isReadOnly || saveDecisions.isPending || mathGroups.length === 0}
              data-tour="plan-save"
            >
              {saveDecisions.isPending ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Check className="mr-2 size-4" />
              )}
              Guardar decisiones
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}


function OverviewCard({
  label, value, hint, tone,
}: {
  label: string
  value: string
  hint?: string
  tone: 'neutral' | 'parked' | 'saved'
}) {
  const toneClass =
    tone === 'parked'
      ? 'text-amber-700 dark:text-amber-400'
      : tone === 'saved'
        ? 'text-green-700 dark:text-green-400'
        : 'text-foreground'

  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-0.5 text-xl font-semibold tabular-nums ${toneClass}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

/** Plan summary over the ON-SCREEN decisions, so a change is felt instantly. */
function PlanOverview({
  totals,
  fmt,
}: {
  totals: PurchasePlanTotals
  fmt: (value: number | null | undefined) => string
}) {
  const pieces = (n: number) => `${n} pz${n !== 1 ? 's' : ''}`

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-tour="plan-summary">
      <OverviewCard
        tone="parked"
        label="Dinero parado"
        value={fmt(totals.parkedMoney)}
        hint={`${pieces(totals.parkedPieces)} en ${totals.parkedGroups} producto${totals.parkedGroups !== 1 ? 's' : ''}`}
      />
      <OverviewCard
        tone="saved"
        label="Ahorrado en mixto/menudeo"
        value={fmt(totals.savedMoney)}
        hint={`${pieces(totals.savedPieces)} que no se compraron de más`}
      />
      <OverviewCard
        tone="neutral"
        label="A pedir a URREA"
        value={`${totals.wholesalePackages} paq`}
        hint={pieces(totals.wholesalePieces)}
      />
      <OverviewCard
        tone="neutral"
        label="A comprar local"
        value={pieces(totals.retailPieces)}
        hint={
          totals.undecidedGroups > 0
            ? `${totals.undecidedGroups} grupo${totals.undecidedGroups !== 1 ? 's' : ''} sin decidir`
            : 'todo decidido'
        }
      />
    </div>
  )
}


interface GroupRowProps {
  group: PurchaseGroupPlan
  choice: PurchaseChoice | null
  onChoice: (choice: PurchaseChoice) => void
  expanded: boolean
  onToggleExpanded: () => void
  fmt: (value: number | null | undefined) => string
  disabled: boolean
}

function GroupRow({
  group, choice, onChoice, expanded, onToggleExpanded, fmt, disabled,
}: GroupRowProps) {
  const math = group.math!
  const rec = group.recommendation
  // With 0 full packages, "mixed" IS pure retail; the badge says so to avoid confusion.
  const badge = rec
    ? rec.type === 'mixed' && rec.suggested === 'retail'
      ? { label: 'Menudeo', className: RECOMMENDATION_BADGE.mixed.className }
      : RECOMMENDATION_BADGE[rec.type]
    : null
  const wholesale = applyChoice(math, 'wholesale')

  // Mixed only adds value with a remainder AND full packages; otherwise it
  // duplicates exact-wholesale or retail.
  const showMixed = math.remainder > 0 && math.packagesFull > 0

  return (
    <div
      className={`rounded-md border p-3 space-y-2 transition-colors ${CHOICE_ROW_CLASS[choice ?? 'undecided']}`}
      data-group-key={group.key}
      // The anchor repeats per group; resolveVisible takes the first (ADR-024).
      data-tour="plan-group"
    >
      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={onToggleExpanded}
          className="shrink-0 text-muted-foreground hover:text-foreground"
          aria-label={expanded ? 'Contraer líneas' : 'Ver líneas de origen'}
        >
          {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        </button>
        <span className="font-mono text-sm font-medium">{group.modelCode}</span>
        <Badge variant="outline">{group.brand}</Badge>
        <span className="text-sm text-muted-foreground truncate max-w-xs">
          {group.catalogDescription ?? group.lines[0]?.description ?? ''}
        </span>
        {badge && <Badge className={badge.className}>{badge.label}</Badge>}
        {group.bucket === 'no_data' && (
          <Badge variant="secondary" className="gap-1">
            <AlertTriangle className="size-3" /> sin precio
          </Badge>
        )}
        {group.decision?.isStale && (
          <Badge className="gap-1 bg-amber-500/15 text-amber-700 dark:text-amber-400">
            <RefreshCw className="size-3" /> Desactualizada
          </Badge>
        )}
      </div>

      <div className="flex items-center gap-4 text-xs text-muted-foreground pl-7 flex-wrap">
        <span>Necesidad: <strong className="text-foreground">{group.needed}</strong></span>
        <span>STD: <strong className="text-foreground">{math.std}</strong></span>
        <span>
          {math.packagesFull} paq completo{math.packagesFull !== 1 ? 's' : ''}
          {math.remainder > 0 && ` + ${math.remainder} resto`}
        </span>
        {math.unitPrice != null && (
          <>
            <span>
              Unitario: <strong className="text-foreground">{fmt(math.unitPrice)}</strong>
            </span>
            <span>
              Paquete ({math.std} pzs):{' '}
              <strong className="text-foreground">{fmt(math.unitPrice * math.std)}</strong>
            </span>
          </>
        )}
        {math.remainder > 0 && (
          <span>
            {/* Same number, opposite meaning: idle money when rounding up, saved
                money when the remainder goes retail. */}
            {choice === 'wholesale' ? 'Queda parado:' : choice ? 'Ahorras:' : 'Parado si redondea:'}{' '}
            <strong
              className={
                choice === 'wholesale'
                  ? 'text-amber-700 dark:text-amber-400'
                  : choice
                    ? 'text-green-700 dark:text-green-400'
                    : 'text-foreground'
              }
            >
              {math.excess} pzs{math.parkedMoney != null && ` ≈ ${fmt(math.parkedMoney)}`}
            </strong>
          </span>
        )}
      </div>

      <RadioGroup
        value={choice ?? ''}
        onValueChange={(value) => onChoice(value as PurchaseChoice)}
        disabled={disabled}
        className="flex flex-wrap gap-x-6 gap-y-1 pl-7"
      >
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <RadioGroupItem value="wholesale" id={`${group.key}-wholesale`} />
          <span>
            Mayoreo — {wholesale.packagesWholesale} paq ({wholesale.packagesWholesale * math.std} pzs
            {math.excess > 0 ? `, sobran ${math.excess}` : ''})
          </span>
        </label>
        {showMixed && (
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <RadioGroupItem value="mixed" id={`${group.key}-mixed`} />
            <span>
              Mixto — {math.packagesFull} paq + {math.remainder} pzs menudeo
            </span>
          </label>
        )}
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <RadioGroupItem value="retail" id={`${group.key}-retail`} />
          <span>Menudeo — {group.needed} pzs locales</span>
        </label>
      </RadioGroup>

      {expanded && (
        <div className="pl-7">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Sección</TableHead>
                <TableHead>ETM</TableHead>
                <TableHead>Código (orden)</TableHead>
                <TableHead className="text-right">A pedir</TableHead>
                <TableHead className="text-right">Precio</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {group.lines.map((line) => (
                <TableRow key={line.itemId}>
                  <TableCell className="text-muted-foreground">
                    {line.sectionLabel || '—'}
                  </TableCell>
                  <TableCell className="font-mono text-sm">{line.etm || '—'}</TableCell>
                  <TableCell className="font-mono text-sm">{line.modelCodeRaw}</TableCell>
                  <TableCell className="text-right">{line.quantityToOrder}</TableCell>
                  <TableCell className="text-right">
                    {line.unitPrice > 0 ? fmt(line.unitPrice) : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}


function FlatLinesTable({
  groups,
  fmt,
}: {
  groups: PurchaseGroupPlan[]
  fmt: (value: number | null | undefined) => string
}) {
  const cols = useVisibleColumns('purchase-planner-flat', FLAT_COLUMNS)
  const lines = groups.flatMap((group) =>
    group.lines.map((line) => ({ group, line })),
  )
  return (
    <Card>
      <CardContent className="pt-6">
        <Table>
          <TableHeader>
            <TableRow>
              {cols.isVisible('section') && <TableHead>Sección</TableHead>}
              {cols.isVisible('etm') && <TableHead>ETM</TableHead>}
              <TableHead>Código</TableHead>
              {cols.isVisible('brand') && <TableHead>Marca</TableHead>}
              {cols.isVisible('qty_to_order') && <TableHead className="text-right">A pedir</TableHead>}
              {cols.isVisible('unit_price') && <TableHead className="text-right">Precio</TableHead>}
              {cols.isVisible('bucket') && <TableHead>Bucket</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map(({ group, line }) => (
              <TableRow key={line.itemId}>
                {cols.isVisible('section') && (
                  <TableCell className="text-muted-foreground">{line.sectionLabel || '—'}</TableCell>
                )}
                {cols.isVisible('etm') && (
                  <TableCell className="font-mono text-sm">{line.etm || '—'}</TableCell>
                )}
                <TableCell className="font-mono text-sm">{line.modelCodeRaw}</TableCell>
                {cols.isVisible('brand') && <TableCell>{group.brand}</TableCell>}
                {cols.isVisible('qty_to_order') && (
                  <TableCell className="text-right">{line.quantityToOrder}</TableCell>
                )}
                {cols.isVisible('unit_price') && (
                  <TableCell className="text-right">
                    {line.unitPrice > 0 ? fmt(line.unitPrice) : '—'}
                  </TableCell>
                )}
                {cols.isVisible('bucket') && (
                  <TableCell>
                    {group.bucket === 'urrea' && <Badge variant="secondary">URREA</Badge>}
                    {group.bucket === 'no_data' && <Badge variant="secondary">sin precio</Badge>}
                    {group.bucket === 'local' && <Badge variant="outline">local</Badge>}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}


function ThresholdsPopover({
  thresholds,
  orderId,
  groups,
}: {
  thresholds: PurchaseThresholds
  orderId: string
  /** Current groups, used to measure the effect of changing the thresholds. */
  groups: readonly PurchaseGroupPlan[]
}) {
  const updateSettings = useUpdateSettings()
  const { refetch } = usePurchasePlan(orderId)
  const [open, setOpen] = useState(false)
  const [money, setMoney] = useState('')
  const [pct, setPct] = useState('')
  // Covers mutation + refetch: the plan is recomputed server-side, so the button
  // stays busy until the new data is there to compare against.
  const [isApplying, setIsApplying] = useState(false)

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setMoney(String(thresholds.money))
      setPct(String(Math.round(thresholds.pct * 100)))
    }
    setOpen(nextOpen)
  }

  const handleSave = async () => {
    const moneyValue = Number(money)
    const pctValue = Number(pct)
    if (!Number.isFinite(moneyValue) || moneyValue <= 0) {
      toast.error('El umbral de dinero debe ser un número mayor a 0')
      return
    }
    if (!Number.isFinite(pctValue) || pctValue <= 0 || pctValue > 100) {
      toast.error('El % parado debe estar entre 1 y 100')
      return
    }
    // Compare against a prior snapshot to report how many recommendations moved.
    const before = new Map(groups.map((g) => [g.key, g.recommendation?.suggested ?? null]))
    setIsApplying(true)
    try {
      await updateSettings.mutateAsync({
        [SETTING_THRESHOLD_MONEY]: moneyValue,
        [SETTING_THRESHOLD_PCT]: pctValue / 100,
      })
      const { data: fresh } = await refetch()
      const changed = (fresh?.plan.groups ?? []).filter(
        (g) => g.math && before.get(g.key) !== (g.recommendation?.suggested ?? null),
      ).length

      toast.success(
        changed === 0
          ? 'Umbrales actualizados · ninguna recomendación cambió'
          : `Umbrales actualizados · ${changed} producto${changed !== 1 ? 's' : ''} cambió de recomendación`,
      )
      setOpen(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al guardar umbrales')
    } finally {
      setIsApplying(false)
    }
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" data-tour="plan-thresholds">
          <Wrench className="mr-2 size-4" />
          Umbrales
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-3">
        <p className="text-sm font-medium">Umbrales de decisión</p>
        <div className="space-y-1.5">
          <Label htmlFor="threshold-money" className="text-xs">
            Dinero parado máximo (MXN) — arriba de esto, el resto va a menudeo
          </Label>
          <Input
            id="threshold-money"
            type="number"
            min="1"
            value={money}
            onChange={(e) => setMoney(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="threshold-pct" className="text-xs">
            % del paquete parado — arriba de esto, se marca para revisar
          </Label>
          <Input
            id="threshold-pct"
            type="number"
            min="1"
            max="100"
            value={pct}
            onChange={(e) => setPct(e.target.value)}
          />
        </div>
        <Button size="sm" className="w-full" onClick={handleSave} disabled={isApplying}>
          {isApplying ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
          {isApplying ? 'Recalculando…' : 'Guardar umbrales'}
        </Button>
      </PopoverContent>
    </Popover>
  )
}
