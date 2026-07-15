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
  Download,
  Loader2,
  Package,
  RefreshCw,
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useCurrency } from '@/hooks/useCurrency'
import { useSavePurchaseDecisions, type PurchasePlanResponse } from '@/hooks/usePurchasePlan'
import { useUpdateSettings } from '@/hooks/useSettings'
import {
  applyChoice,
  SETTING_THRESHOLD_MONEY,
  SETTING_THRESHOLD_PCT,
  type PurchaseChoice,
  type PurchaseGroupPlan,
  type PurchaseThresholds,
} from '@/lib/purchase-plan'
import {
  generateLocalPurchaseExcel,
  downloadLocalPurchaseExcel,
  type LocalPurchaseRow,
} from '@/lib/excel/generator'

interface PurchasePlannerProps {
  data: PurchasePlanResponse
}

/** Reconstruye la elección detrás de una decisión guardada (para pre-seleccionar). */
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

export function PurchasePlanner({ data }: PurchasePlannerProps) {
  const { order, plan } = data
  const { push } = useRouter()
  const fmt = useCurrency()
  const saveDecisions = useSavePurchaseDecisions(order.id)

  /** Solo overrides explícitos del usuario; el default se deriva al renderizar. */
  const [overrides, setOverrides] = useState<Record<string, PurchaseChoice>>({})
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [flatView, setFlatView] = useState(false)

  const mathGroups = plan.groups.filter((g) => g.bucket !== 'local')
  const localGroups = plan.groups.filter((g) => g.bucket === 'local')
  const isReadOnly = ['completed', 'cancelled'].includes(order.status)

  const effectiveChoice = (group: PurchaseGroupPlan): PurchaseChoice | null =>
    overrides[group.key] ?? savedChoice(group) ?? group.recommendation?.suggested ?? null

  const pendingCount = mathGroups.filter((g) => !effectiveChoice(g)).length

  const toggleExpanded = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const handleSave = async () => {
    if (pendingCount > 0) {
      toast.error(
        `Falta decidir ${pendingCount} grupo${pendingCount !== 1 ? 's' : ''} marcado${pendingCount !== 1 ? 's' : ''} como "Revisar".`,
      )
      return
    }
    const decisions = mathGroups.map((group) => {
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
    try {
      await saveDecisions.mutateAsync(decisions)
      toast.success('Decisiones de compra guardadas')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al guardar las decisiones')
    }
  }

  const handleExportLocal = () => {
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
    downloadLocalPurchaseExcel(generateLocalPurchaseExcel(rows), order.customer_name)
    toast.success(`Lista de compra local descargada (${rows.length} filas)`)
  }

  return (
    <div className="space-y-6 pb-24">
      {/* Header */}
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
          <ThresholdsPopover thresholds={plan.thresholds} />
          <Button
            variant="outline"
            size="sm"
            onClick={() => setFlatView((v) => !v)}
          >
            {flatView ? 'Vista agrupada' : 'Vista plana'}
          </Button>
        </div>
      </div>

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
        <FlatLinesTable groups={plan.groups} fmt={fmt} />
      ) : (
        <>
          {/* Grupos con matemática (URREA + sin precio) */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Package className="size-4" />
                Candidatos a pedido URREA ({mathGroups.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {mathGroups.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Ningún producto a pedir cruza con el catálogo URREA.
                </p>
              )}
              {mathGroups.map((group) => (
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

          {/* Compra local (sin catálogo) */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ShoppingCart className="size-4" />
                Compra local — sin catálogo URREA ({localGroups.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {localGroups.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Todos los productos a pedir están en el catálogo URREA.
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
                    {localGroups.map((group) => (
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

      {/* Footer sticky */}
      <div className="fixed bottom-0 left-0 right-0 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="flex items-center justify-between gap-4 px-6 py-3 max-w-screen-2xl mx-auto">
          <p className="text-sm text-muted-foreground">
            {mathGroups.length - pendingCount} de {mathGroups.length} grupos decididos
            {pendingCount > 0 && (
              <span className="text-amber-600"> · {pendingCount} por revisar</span>
            )}
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={handleExportLocal}>
              <Download className="mr-2 size-4" />
              Exportar compra local
            </Button>
            <Button
              onClick={handleSave}
              disabled={isReadOnly || saveDecisions.isPending || mathGroups.length === 0}
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

// ─── Fila de grupo con math + decisión ──────────────────────────────────

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
  const badge = rec ? RECOMMENDATION_BADGE[rec.type] : null
  const wholesale = applyChoice(math, 'wholesale')

  // Mixto solo aporta cuando hay resto Y paquetes completos (si no, duplica
  // a mayoreo-exacto o a menudeo).
  const showMixed = math.remainder > 0 && math.packagesFull > 0

  return (
    <div className="rounded-md border p-3 space-y-2" data-group-key={group.key}>
      {/* Línea principal */}
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

      {/* Stats */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground pl-7 flex-wrap">
        <span>Necesidad: <strong className="text-foreground">{group.needed}</strong></span>
        <span>STD: <strong className="text-foreground">{math.std}</strong></span>
        <span>
          {math.packagesFull} paq completo{math.packagesFull !== 1 ? 's' : ''}
          {math.remainder > 0 && ` + ${math.remainder} resto`}
        </span>
        {math.remainder > 0 && (
          <span>
            Parado si redondea:{' '}
            <strong className="text-foreground">
              {math.excess} pzs{math.parkedMoney != null && ` ≈ ${fmt(math.parkedMoney)}`}
            </strong>
          </span>
        )}
      </div>

      {/* Decisión */}
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

      {/* Líneas de origen */}
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

// ─── Vista plana (solo visualización) ───────────────────────────────────

function FlatLinesTable({
  groups,
  fmt,
}: {
  groups: PurchaseGroupPlan[]
  fmt: (value: number | null | undefined) => string
}) {
  const lines = groups.flatMap((group) =>
    group.lines.map((line) => ({ group, line })),
  )
  return (
    <Card>
      <CardContent className="pt-6">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Sección</TableHead>
              <TableHead>ETM</TableHead>
              <TableHead>Código</TableHead>
              <TableHead>Marca</TableHead>
              <TableHead className="text-right">A pedir</TableHead>
              <TableHead className="text-right">Precio</TableHead>
              <TableHead>Bucket</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map(({ group, line }) => (
              <TableRow key={line.itemId}>
                <TableCell className="text-muted-foreground">{line.sectionLabel || '—'}</TableCell>
                <TableCell className="font-mono text-sm">{line.etm || '—'}</TableCell>
                <TableCell className="font-mono text-sm">{line.modelCodeRaw}</TableCell>
                <TableCell>{group.brand}</TableCell>
                <TableCell className="text-right">{line.quantityToOrder}</TableCell>
                <TableCell className="text-right">
                  {line.unitPrice > 0 ? fmt(line.unitPrice) : '—'}
                </TableCell>
                <TableCell>
                  {group.bucket === 'urrea' && <Badge variant="secondary">URREA</Badge>}
                  {group.bucket === 'no_data' && <Badge variant="secondary">sin precio</Badge>}
                  {group.bucket === 'local' && <Badge variant="outline">local</Badge>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

// ─── Popover de umbrales ────────────────────────────────────────────────

function ThresholdsPopover({ thresholds }: { thresholds: PurchaseThresholds }) {
  const updateSettings = useUpdateSettings()
  const [open, setOpen] = useState(false)
  const [money, setMoney] = useState('')
  const [pct, setPct] = useState('')

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
    try {
      await updateSettings.mutateAsync({
        [SETTING_THRESHOLD_MONEY]: moneyValue,
        [SETTING_THRESHOLD_PCT]: pctValue / 100,
      })
      toast.success('Umbrales actualizados')
      setOpen(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al guardar umbrales')
    }
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
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
        <Button
          size="sm"
          className="w-full"
          onClick={handleSave}
          disabled={updateSettings.isPending}
        >
          {updateSettings.isPending ? (
            <Loader2 className="mr-2 size-4 animate-spin" />
          ) : null}
          Guardar umbrales
        </Button>
      </PopoverContent>
    </Popover>
  )
}
