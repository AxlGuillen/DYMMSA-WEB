'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  ArrowLeft,
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Download,
  Loader2,
  Plus,
  Trash2,
} from '@/components/icons'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useSaveCutPlan, useSavePresentation, type CutPlanResponse, type CutPlanCandidate, type SaveCutPieceInput } from '@/hooks/useCutPlan'
import { useUpdateSettings } from '@/hooks/useSettings'
import {
  formatMm,
  formatMm2,
  packBars,
  packStrip,
  plateNetNeeds,
  tubeNetNeeds,
  SETTING_CUT_MARGIN_MM,
  type PlatePieceInput,
  type TubePieceInput,
} from '@/lib/cut-plan'
import { CutBarDiagram } from '@/components/orders/CutBarDiagram'
import { CutStripDiagram } from '@/components/orders/CutStripDiagram'
import { startOverview } from '@/lib/tours'
import { CUT_PLANNER_TOUR } from '@/lib/tours/cut-planner'
import type { CutMaterialType, CutPlanPiece } from '@/types/database'

interface CutPlannerProps {
  data: CutPlanResponse
}

/** Fila editable (inputs como string; se parsea al calcular/guardar). */
interface PieceDraft {
  key: string
  type: CutMaterialType
  diameter: string
  thickness: string
  width: string
  length: string
  quantity: string
  requestedLabel: string
  sourceItemId: string | null
  etm: string | null
}

/** Unidad física ya acomodada (pieza × ocurrencia) — identidad para mover. */
interface UnitRef {
  unitKey: string
  lengthMm: number
}

const toDraft = (piece: CutPlanPiece): PieceDraft => ({
  key: piece.id,
  type: piece.material_type,
  diameter: String(piece.diameter_mm ?? ''),
  thickness: String(piece.thickness_mm ?? ''),
  width: String(piece.width_mm ?? ''),
  length: String(piece.length_mm),
  quantity: String(piece.quantity),
  requestedLabel: piece.requested_label ?? '',
  sourceItemId: piece.source_item_id,
  etm: null,
})

const parseCommon = (draft: PieceDraft) => {
  const lengthMm = Number(draft.length)
  const quantity = Number(draft.quantity)
  if (!(lengthMm > 0) || !Number.isInteger(quantity) || quantity < 1) return null
  return { lengthMm, quantity }
}

const parseTube = (draft: PieceDraft): TubePieceInput | null => {
  if (draft.type !== 'tube') return null
  const base = parseCommon(draft)
  const diameterMm = Number(draft.diameter)
  if (!base || !(diameterMm > 0)) return null
  return { id: draft.key, diameterMm, ...base }
}

const parsePlate = (draft: PieceDraft): PlatePieceInput | null => {
  if (draft.type !== 'plate') return null
  const base = parseCommon(draft)
  const thicknessMm = Number(draft.thickness)
  const widthMm = Number(draft.width)
  if (!base || !(thicknessMm > 0) || !(widthMm > 0)) return null
  return { id: draft.key, thicknessMm, widthMm, ...base }
}

/** Firma de las entradas del acomodo: si cambia, el layout manual se descarta. */
const layoutSignature = (pieces: TubePieceInput[], barLengthMm: number, marginMm: number) =>
  JSON.stringify([barLengthMm, marginMm, pieces.map((p) => [p.lengthMm, p.quantity]).sort()])

/** Da identidad estable a cada unidad del acomodo automático (para moverlas). */
function toUnitBars(bars: { segments: { lengthMm: number }[] }[]): UnitRef[][] {
  let counter = 0
  return bars.map((bar) =>
    bar.segments.map((segment) => ({ unitKey: `u${counter++}`, lengthMm: segment.lengthMm })),
  )
}

export function CutPlanner({ data }: CutPlannerProps) {
  const { order } = data
  const { push } = useRouter()
  const saveCutPlan = useSaveCutPlan(order.id)
  const savePresentation = useSavePresentation(order.id)
  const updateSettings = useUpdateSettings()

  const isReadOnly = ['completed', 'cancelled'].includes(order.status)

  const [drafts, setDrafts] = useState<PieceDraft[]>(() => data.pieces.map(toDraft))
  const [margin, setMargin] = useState(String(data.marginMm))
  const [barLen, setBarLen] = useState<Record<string, string>>({})
  const [stripWidth, setStripWidth] = useState<Record<string, string>>({})
  const [manualLayouts, setManualLayouts] = useState<
    Record<string, { sig: string; bars: UnitRef[][] }>
  >({})

  const marginParsed = Number(margin)
  const marginMm = Number.isFinite(marginParsed) && marginParsed >= 0 ? marginParsed : data.marginMm

  const tubeDrafts = drafts.filter((d) => d.type === 'tube')
  const plateDrafts = drafts.filter((d) => d.type === 'plate')
  const validTubes = tubeDrafts.flatMap((d) => {
    const piece = parseTube(d)
    return piece ? [piece] : []
  })
  const validPlates = plateDrafts.flatMap((d) => {
    const piece = parsePlate(d)
    return piece ? [piece] : []
  })
  const invalidCount = drafts.length - validTubes.length - validPlates.length

  const tubeNeeds = tubeNetNeeds(validTubes, marginMm)
  const plateNeeds = plateNetNeeds(validPlates)

  const candidates = data.candidates.filter(
    (candidate) => !drafts.some((draft) => draft.sourceItemId === candidate.itemId),
  )

  const updateDraft = (key: string, patch: Partial<PieceDraft>) =>
    setDrafts((prev) => prev.map((d) => (d.key === key ? { ...d, ...patch } : d)))

  const addDraft = (type: CutMaterialType, candidate?: CutPlanCandidate) =>
    setDrafts((prev) => [
      ...prev,
      {
        key: crypto.randomUUID(),
        type,
        diameter: type === 'tube' && candidate?.diameterMm ? String(candidate.diameterMm) : '',
        thickness: type === 'plate' && candidate?.thicknessMm ? String(candidate.thicknessMm) : '',
        width: type === 'plate' && candidate?.widthMm ? String(candidate.widthMm) : '',
        length: candidate?.lengthMm ? String(candidate.lengthMm) : '',
        quantity: String(candidate?.quantity ?? 1),
        requestedLabel: candidate?.description ?? '',
        sourceItemId: candidate?.itemId ?? null,
        etm: candidate?.etm ?? null,
      },
    ])

  /** Mueve una unidad a la barra vecina (en la última, ▶ abre barra nueva). */
  const moveUnit = (
    diameterKey: string,
    sig: string,
    bars: UnitRef[][],
    barIndex: number,
    unitIndex: number,
    direction: -1 | 1,
  ) => {
    const target = barIndex + direction
    if (target < 0) return
    const next = bars.map((bar) => [...bar])
    const [unit] = next[barIndex].splice(unitIndex, 1)
    if (target >= next.length) next.push([unit])
    else next[target].push(unit)
    setManualLayouts((prev) => ({
      ...prev,
      [diameterKey]: { sig, bars: next.filter((bar) => bar.length > 0) },
    }))
  }

  const buildPayload = (): SaveCutPieceInput[] => [
    ...validTubes.map((piece) => {
      const draft = drafts.find((d) => d.key === piece.id)!
      return {
        material_type: 'tube' as const,
        diameter_mm: piece.diameterMm,
        length_mm: piece.lengthMm,
        quantity: piece.quantity,
        requested_label: draft.requestedLabel || null,
        source_item_id: draft.sourceItemId,
      }
    }),
    ...validPlates.map((piece) => {
      const draft = drafts.find((d) => d.key === piece.id)!
      return {
        material_type: 'plate' as const,
        thickness_mm: piece.thicknessMm,
        width_mm: piece.widthMm,
        length_mm: piece.lengthMm,
        quantity: piece.quantity,
        requested_label: draft.requestedLabel || null,
        source_item_id: draft.sourceItemId,
      }
    }),
  ]

  const handleSave = async () => {
    if (invalidCount > 0) {
      toast.error(
        `Hay ${invalidCount} pieza${invalidCount !== 1 ? 's' : ''} incompleta${invalidCount !== 1 ? 's' : ''} — revisa medidas y cantidades.`,
      )
      return
    }
    try {
      await saveCutPlan.mutateAsync(buildPayload())
      // Presentaciones capturadas → catálogo que se arma solo (v1: tubos; las
      // tiras de placa se venden por largo y no tienen presentación fija).
      const captures = tubeNeeds
        .map((group) => ({ diameter: group.diameterMm, length: Number(barLen[String(group.diameterMm)]) }))
        .filter(({ length }) => length > 0)
        .map(({ diameter, length }) =>
          savePresentation.mutateAsync({ material_type: 'tube', diameter_mm: diameter, length_mm: length }),
        )
      const results = await Promise.allSettled(captures)
      if (results.some((r) => r.status === 'rejected')) {
        toast.warning('La lista se guardó, pero una presentación no se pudo registrar')
      }
      toast.success('Lista de corte guardada')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al guardar la lista de corte')
    }
  }

  const handleMarginBlur = async () => {
    if (marginMm === data.marginMm) return
    try {
      await updateSettings.mutateAsync({ [SETTING_CUT_MARGIN_MM]: marginMm })
      toast.success(`Margen de corte: ${formatMm(marginMm)}`)
    } catch {
      toast.error('No se pudo guardar el margen de corte')
    }
  }

  /** Excel del pedido al proveedor: la necesidad neta por medida (momento 1). */
  const handleExportRequest = async () => {
    const rows = [
      ...tubeNeeds.map((group) => ({
        material: 'Tubo cobre',
        measure: `Ø${group.diameterMm} mm`,
        pieces: group.totalUnits,
        request: formatMm(group.netLengthMm),
      })),
      ...plateNeeds.map((group) => {
        const width = Number(stripWidth[String(group.thicknessMm)])
        const pack = width > 0
          ? packStrip(group.pieces.map((p) => ({ id: p.id, widthMm: p.widthMm, lengthMm: p.lengthMm, quantity: p.quantity })), width, marginMm)
          : null
        return {
          material: 'Placa cobre',
          measure: `${group.thicknessMm} mm · ancho ≥ ${group.minWidthMm} mm`,
          pieces: group.totalUnits,
          request: pack && pack.impossible.length === 0
            ? `${formatMm(pack.totalLengthMm)} de tira de ${formatMm(width)}`
            : `área ${formatMm2(group.areaMm2)}`,
        }
      }),
    ]
    if (rows.length === 0) {
      toast.info('No hay piezas válidas que pedir')
      return
    }
    try {
      // Carga diferida: xlsx solo baja al exportar.
      const { generateCutRequestExcel, downloadCutRequestExcel } = await import('@/lib/excel/generator')
      downloadCutRequestExcel(generateCutRequestExcel(rows), order.customer_name)
      toast.success(`Pedido de material descargado (${rows.length} medidas)`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo exportar el pedido')
    }
  }

  const draftsTable = (rows: PieceDraft[], type: CutMaterialType) => (
    <Table>
      <TableHeader>
        <TableRow>
          {type === 'tube' ? (
            <TableHead className="w-[110px]">Ø (mm)</TableHead>
          ) : (
            <>
              <TableHead className="w-[110px]">Espesor (mm)</TableHead>
              <TableHead className="w-[110px]">Ancho (mm)</TableHead>
            </>
          )}
          <TableHead className="w-[130px]">Longitud (mm)</TableHead>
          <TableHead className="w-[100px]">Cantidad</TableHead>
          <TableHead>Pedido original</TableHead>
          <TableHead className="w-[120px]">Origen</TableHead>
          <TableHead className="w-[60px] print:hidden" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((draft) => {
          const invalid = type === 'tube' ? !parseTube(draft) : !parsePlate(draft)
          return (
            <TableRow key={draft.key} className={invalid ? 'bg-amber-500/10' : undefined}>
              {type === 'tube' ? (
                <TableCell>
                  <Input
                    type="number" min="0" className="h-8" value={draft.diameter}
                    disabled={isReadOnly} aria-label="Diámetro (mm)"
                    onChange={(e) => updateDraft(draft.key, { diameter: e.target.value })}
                  />
                </TableCell>
              ) : (
                <>
                  <TableCell>
                    <Input
                      type="number" min="0" className="h-8" value={draft.thickness}
                      disabled={isReadOnly} aria-label="Espesor (mm)"
                      onChange={(e) => updateDraft(draft.key, { thickness: e.target.value })}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number" min="0" className="h-8" value={draft.width}
                      disabled={isReadOnly} aria-label="Ancho (mm)"
                      onChange={(e) => updateDraft(draft.key, { width: e.target.value })}
                    />
                  </TableCell>
                </>
              )}
              <TableCell>
                <Input
                  type="number" min="0" className="h-8" value={draft.length}
                  disabled={isReadOnly} aria-label="Longitud (mm)"
                  onChange={(e) => updateDraft(draft.key, { length: e.target.value })}
                />
              </TableCell>
              <TableCell>
                <Input
                  type="number" min="1" className="h-8" value={draft.quantity}
                  disabled={isReadOnly} aria-label="Cantidad"
                  onChange={(e) => updateDraft(draft.key, { quantity: e.target.value })}
                />
              </TableCell>
              <TableCell>
                <Input
                  className="h-8" value={draft.requestedLabel}
                  disabled={isReadOnly} placeholder="Lo que pidió el cliente"
                  aria-label="Pedido original"
                  onChange={(e) => updateDraft(draft.key, { requestedLabel: e.target.value })}
                />
              </TableCell>
              <TableCell>
                {draft.etm || draft.sourceItemId ? (
                  <Badge variant="secondary" className="font-mono text-xs">
                    {draft.etm ?? 'de la orden'}
                  </Badge>
                ) : (
                  <span className="text-xs text-muted-foreground">manual</span>
                )}
              </TableCell>
              <TableCell className="print:hidden">
                <Button
                  size="icon" variant="ghost"
                  className="size-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  disabled={isReadOnly} aria-label="Quitar pieza"
                  onClick={() => setDrafts((prev) => prev.filter((d) => d.key !== draft.key))}
                >
                  <Trash2 className="size-4" />
                </Button>
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )

  return (
    <div className="space-y-6 pb-24">
      {/* Header */}
      <div className="flex items-start gap-4 print:hidden">
        <Button
          variant="ghost" size="icon" className="mt-0.5 shrink-0"
          onClick={() => push(`/dashboard/orders/${order.id}`)}
        >
          <ArrowLeft className="size-5" />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">Planificar corte</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {order.name || order.customer_name} · tubos y placas de cobre (DYMMSA)
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <Button
            variant="ghost" size="sm"
            aria-label="Vista guiada"
            onClick={() => startOverview(CUT_PLANNER_TOUR)}
          >
            <CircleHelp className="mr-2 size-4" />
            Vista guiada
          </Button>
          <div data-tour="cut-margin" className="flex items-center gap-2">
            <Label htmlFor="cut-margin" className="text-xs text-muted-foreground">
              Margen por corte (mm)
            </Label>
            <Input
              id="cut-margin" type="number" min="0" className="h-8 w-20 text-right"
              value={margin} disabled={isReadOnly}
              onChange={(e) => setMargin(e.target.value)}
              onBlur={handleMarginBlur}
            />
          </div>
          <div data-tour="cut-actions" className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={handleExportRequest}>
              <Download className="mr-2 size-4" />
              Excel pedido
            </Button>
            <Button variant="outline" size="sm" onClick={() => window.print()}>
              Imprimir
            </Button>
          </div>
        </div>
      </div>

      {/* Candidatos DYMMSA de la orden */}
      {!isReadOnly && candidates.length > 0 && (
        <Card data-tour="cut-candidates" className="print:hidden">
          <CardHeader>
            <CardTitle className="text-base">
              Piezas DYMMSA de la orden ({candidates.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {candidates.map((candidate) => (
              <div key={candidate.itemId} className="flex items-center gap-3 text-sm">
                <Badge variant="outline" className="font-mono">{candidate.etm ?? '—'}</Badge>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  {candidate.description ?? 'Sin descripción'}
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  ×{candidate.quantity}
                </span>
                {candidate.cutKind ? (
                  <Button size="sm" variant="outline" onClick={() => addDraft(candidate.cutKind!, candidate)}>
                    <Plus className="mr-1 size-3.5" />
                    Agregar
                  </Button>
                ) : (
                  // Sin medidas nominales no se sabe qué es: el usuario decide.
                  <div className="flex gap-1">
                    <Button size="sm" variant="outline" onClick={() => addDraft('tube', candidate)}>
                      Tubo
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => addDraft('plate', candidate)}>
                      Placa
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Lista de corte: tubos */}
      <Card data-tour="cut-tubes">
        <CardHeader className="print:hidden">
          <CardTitle className="text-base">Lista de corte — tubos ({tubeDrafts.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {tubeDrafts.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin piezas de tubo.</p>
          ) : (
            draftsTable(tubeDrafts, 'tube')
          )}
          {!isReadOnly && (
            <Button variant="outline" size="sm" className="print:hidden" onClick={() => addDraft('tube')}>
              <Plus className="mr-2 size-4" />
              Agregar tubo manual
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Lista de corte: placas */}
      <Card data-tour="cut-plates">
        <CardHeader className="print:hidden">
          <CardTitle className="text-base">Lista de corte — placas ({plateDrafts.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {plateDrafts.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin piezas de placa.</p>
          ) : (
            draftsTable(plateDrafts, 'plate')
          )}
          {!isReadOnly && (
            <Button variant="outline" size="sm" className="print:hidden" onClick={() => addDraft('plate')}>
              <Plus className="mr-2 size-4" />
              Agregar placa manual
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Tubos: necesidad + acomodo por diámetro */}
      {tubeNeeds.map((group) => {
        const diameterKey = String(group.diameterMm)
        const barLength = Number(barLen[diameterKey])
        const suggestions = data.presentations
          .filter((p) => p.material_type === 'tube' && p.diameter_mm === group.diameterMm)
          .slice(0, 4)

        const pack = barLength > 0
          ? packBars(group.pieces.map((p) => ({ id: p.id, lengthMm: p.lengthMm, quantity: p.quantity })), barLength, marginMm)
          : null

        const autoBars = toUnitBars(pack?.bars ?? [])
        const sig = layoutSignature(group.pieces, barLength, marginMm)
        const manual = manualLayouts[diameterKey]
        const bars = manual && manual.sig === sig ? manual.bars : autoBars

        return (
          <Card key={`tube-${diameterKey}`} data-tour="cut-group-tube">
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                Ø{group.diameterMm} mm
                <Badge variant="secondary">
                  pedir {formatMm(group.netLengthMm)} · {group.totalUnits} pzs
                </Badge>
                {pack && (
                  <Badge variant="outline">
                    {bars.length} barra{bars.length !== 1 ? 's' : ''} de {formatMm(barLength)}
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 print:hidden">
                <Label htmlFor={`bar-${diameterKey}`} className="text-xs text-muted-foreground">
                  Barra del proveedor (mm)
                </Label>
                <Input
                  id={`bar-${diameterKey}`} type="number" min="0" className="h-8 w-28"
                  placeholder="p. ej. 6000"
                  value={barLen[diameterKey] ?? ''}
                  onChange={(e) => setBarLen((prev) => ({ ...prev, [diameterKey]: e.target.value }))}
                />
                {suggestions.map((s) => (
                  <Button
                    key={s.id} size="sm" variant="outline" className="h-7 text-xs"
                    onClick={() => setBarLen((prev) => ({ ...prev, [diameterKey]: String(s.length_mm) }))}
                  >
                    {formatMm(s.length_mm)}
                  </Button>
                ))}
                {suggestions.length === 0 && (
                  <span className="text-xs text-muted-foreground">
                    Sin presentaciones previas de este diámetro — captura la que ofrezca el proveedor.
                  </span>
                )}
              </div>

              {pack && pack.impossible.length > 0 && (
                <div className="flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red-600" />
                  <span>
                    {pack.impossible.map((piece) => `${piece.quantity} × ${formatMm(piece.lengthMm)}`).join(', ')}{' '}
                    no cabe{pack.impossible.length !== 1 ? 'n' : ''} en una barra de {formatMm(barLength)}.
                  </span>
                </div>
              )}

              {bars.map((bar, barIndex) => (
                <div key={barIndex} className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">Barra {barIndex + 1}</p>
                  <CutBarDiagram barLengthMm={barLength} marginMm={marginMm} segments={bar} />
                  {!isReadOnly && (
                    <div className="flex flex-wrap gap-1.5 print:hidden">
                      {bar.map((unit, unitIndex) => (
                        <span
                          key={unit.unitKey}
                          className="inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 text-xs tabular-nums"
                        >
                          <button
                            type="button"
                            className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                            disabled={barIndex === 0}
                            aria-label="Mover a la barra anterior"
                            onClick={() => moveUnit(diameterKey, sig, bars, barIndex, unitIndex, -1)}
                          >
                            <ChevronLeft className="size-3.5" />
                          </button>
                          {formatMm(unit.lengthMm)}
                          <button
                            type="button"
                            className="text-muted-foreground hover:text-foreground"
                            aria-label={barIndex === bars.length - 1 ? 'Mover a una barra nueva' : 'Mover a la barra siguiente'}
                            onClick={() => moveUnit(diameterKey, sig, bars, barIndex, unitIndex, 1)}
                          >
                            <ChevronRight className="size-3.5" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        )
      })}

      {/* Placas: necesidad + acomodo en tira por espesor */}
      {plateNeeds.map((group) => {
        const thicknessKey = String(group.thicknessMm)
        const width = Number(stripWidth[thicknessKey])
        const pack = width > 0
          ? packStrip(group.pieces.map((p) => ({ id: p.id, widthMm: p.widthMm, lengthMm: p.lengthMm, quantity: p.quantity })), width, marginMm)
          : null

        return (
          <Card key={`plate-${thicknessKey}`} data-tour="cut-group-plate">
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                Placa {group.thicknessMm} mm
                <Badge variant="secondary">
                  {group.totalUnits} pzs · área {formatMm2(group.areaMm2)}
                </Badge>
                <Badge variant="outline">ancho mínimo {formatMm(group.minWidthMm)}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 print:hidden">
                <Label htmlFor={`strip-${thicknessKey}`} className="text-xs text-muted-foreground">
                  Ancho de la tira del proveedor (mm)
                </Label>
                <Input
                  id={`strip-${thicknessKey}`} type="number" min="0" className="h-8 w-28"
                  placeholder={`≥ ${group.minWidthMm}`}
                  value={stripWidth[thicknessKey] ?? ''}
                  onChange={(e) => setStripWidth((prev) => ({ ...prev, [thicknessKey]: e.target.value }))}
                />
                <span className="text-xs text-muted-foreground">
                  La tira se compra por largo: captura el ancho que ofrezca el proveedor.
                </span>
              </div>

              {pack && pack.impossible.length > 0 && (
                <div className="flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red-600" />
                  <span>
                    Hay pieza{pack.impossible.length !== 1 ? 's' : ''} más ancha
                    {pack.impossible.length !== 1 ? 's' : ''} que la tira de {formatMm(width)} — se
                    necesita al menos {formatMm(group.minWidthMm)} de ancho.
                  </span>
                </div>
              )}

              {pack && pack.shelves.length > 0 && (
                <CutStripDiagram
                  stripWidthMm={width}
                  marginMm={marginMm}
                  shelves={pack.shelves}
                  totalLengthMm={pack.totalLengthMm}
                />
              )}
            </CardContent>
          </Card>
        )
      })}

      {/* Footer sticky */}
      <div className="fixed bottom-0 left-0 right-0 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 print:hidden">
        <div className="mx-auto flex max-w-screen-2xl items-center justify-between gap-4 px-6 py-3">
          <p className="text-sm text-muted-foreground">
            {validTubes.length + validPlates.length} pieza
            {validTubes.length + validPlates.length !== 1 ? 's' : ''} lista
            {validTubes.length + validPlates.length !== 1 ? 's' : ''}
            {invalidCount > 0 && (
              <span className="text-amber-600"> · {invalidCount} incompleta{invalidCount !== 1 ? 's' : ''}</span>
            )}
          </p>
          <Button data-tour="cut-save" onClick={handleSave} disabled={isReadOnly || saveCutPlan.isPending}>
            {saveCutPlan.isPending ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Check className="mr-2 size-4" />
            )}
            Guardar lista de corte
          </Button>
        </div>
      </div>
    </div>
  )
}
