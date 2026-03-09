'use client'

import { useState } from 'react'
import Image from 'next/image'
import {
  CheckCircle,
  XCircle,
  Package,
  CheckSquare,
  Send,
  Loader2,
  ShieldCheck,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
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
  TableFooter,
} from '@/components/ui/table'
import type { QuotationWithItems, DeliveryTime } from '@/types/database'

const DELIVERY_TIME_LABELS: Record<DeliveryTime, string> = {
  immediate:  'Inmediato',
  '2_3_days': '2 a 3 días',
  '3_5_days': '3 a 5 días',
  '1_week':   '1 semana',
  '2_weeks':  '2 semanas',
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

export function ApprovalClient({ quotation, token }: Props) {
  const isEditable = quotation.status === 'sent_for_approval'

  // Default: everything starts as NOT approved — client only clicks what they want
  const [decisions, setDecisions] = useState<ItemDecision[]>(
    quotation.quotation_items.map((item) => ({
      item_id:     item.id,
      is_approved: item.is_approved === true, // preserve if re-visiting
    }))
  )
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitted, setSubmitted]       = useState(false)

  const approvedCount    = decisions.filter((d) => d.is_approved).length
  const notApprovedCount = decisions.length - approvedCount

  const approvedTotal = quotation.quotation_items.reduce((sum, item) => {
    const dec = decisions.find((d) => d.item_id === item.id)
    if (dec?.is_approved && item.unit_price != null && item.quantity != null) {
      return sum + item.unit_price * item.quantity
    }
    return sum
  }, 0)

  const toggleDecision = (item_id: string) => {
    setDecisions((prev) =>
      prev.map((d) =>
        d.item_id === item_id ? { ...d, is_approved: !d.is_approved } : d
      )
    )
  }

  const handleApproveAll = () => {
    setDecisions((prev) => prev.map((d) => ({ ...d, is_approved: true })))
  }

  const handleSubmit = async () => {
    setIsSubmitting(true)
    try {
      const res = await fetch(`/api/approve/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decisions: decisions.map((d) => ({
            item_id:     d.item_id,
            is_approved: d.is_approved,
          })),
        }),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.message)
      }

      setSubmitted(true)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al enviar decisión')
    } finally {
      setIsSubmitting(false)
    }
  }

  // ── Success screen ──────────────────────────────────────────────────
  if (submitted) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-slate-100 dark:bg-zinc-950 bg-[radial-gradient(circle,_#cbd5e1_1px,_transparent_1px)] dark:bg-[radial-gradient(circle,_#27272a_1px,_transparent_1px)] [background-size:22px_22px]">
        <div className="mb-8">
          <Image
            src="/dymmsa-logo.webp"
            alt="DYMMSA"
            width={210}
            height={84}
            className="object-contain"
            priority
          />
        </div>
        <Card className="max-w-md w-full text-center shadow-xl border border-slate-200 dark:border-zinc-700">
          <CardContent className="pt-10 pb-10 space-y-5">
            <div className="flex justify-center">
              <div className="rounded-full bg-green-100 dark:bg-green-900/30 p-4">
                <ShieldCheck className="h-14 w-14 text-green-600 dark:text-green-400" />
              </div>
            </div>
            <div className="space-y-1">
              <h2 className="text-2xl font-bold tracking-tight">¡Aprobación enviada!</h2>
              <p className="text-muted-foreground text-sm">
                Tu selección ha sido registrada. El equipo de DYMMSA la recibirá de inmediato.
              </p>
            </div>
            <div className="flex justify-center gap-8 pt-2">
              <div className="text-center">
                <p className="text-3xl font-bold text-green-600 dark:text-green-400">{approvedCount}</p>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Aprobados</p>
              </div>
              <div className="w-px bg-border" />
              <div className="text-center">
                <p className="text-3xl font-bold text-slate-400 dark:text-zinc-500">{notApprovedCount}</p>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">No aprobados</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <p className="mt-8 text-xs text-slate-400 dark:text-zinc-600">
          DYMMSA · Distribuidor autorizado URREA · Morelia, Mich.
        </p>
      </div>
    )
  }


  const alreadyProcessed =
    quotation.status === 'approved' ||
    quotation.status === 'rejected' ||
    quotation.status === 'converted_to_order'

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-zinc-950 bg-[radial-gradient(circle,_#cbd5e1_1px,_transparent_1px)] dark:bg-[radial-gradient(circle,_#27272a_1px,_transparent_1px)] [background-size:22px_22px]">
      {/* Top header bar */}
      <header className="bg-white dark:bg-zinc-900 border-b border-slate-200 dark:border-zinc-700 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Image
              src="/dymmsa-logo.webp"
              alt="DYMMSA"
              width={120}
              height={48}
              className="object-contain"
              priority
            />
            <div className="hidden sm:block w-px h-8 bg-slate-200 dark:bg-zinc-700" />
            <div className="hidden sm:block">
              <p className="text-slate-700 dark:text-zinc-200 text-sm font-medium leading-tight">Cotización para aprobación</p>
              <p className="text-slate-400 dark:text-zinc-500 text-xs">Distribuidor autorizado URREA · Morelia, Mich.</p>
            </div>
          </div>
          <Badge variant="outline" className="border-slate-300 dark:border-zinc-600 text-slate-500 dark:text-zinc-400 text-xs">
            Documento seguro
          </Badge>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">

        {/* Quotation summary card */}
        <Card className="shadow-lg border border-slate-200 dark:border-zinc-700 overflow-hidden border-t-4 border-t-[#A30305]">
          <CardContent className="pt-5 pb-5">
            <div className="flex flex-col sm:flex-row sm:items-center gap-5">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-0.5">
                  Cliente
                </p>
                <p className="text-2xl font-bold tracking-tight truncate">{quotation.customer_name}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Emitida el{' '}
                  {new Date(quotation.created_at).toLocaleDateString('es-MX', {
                    day: '2-digit', month: 'long', year: 'numeric',
                  })}
                </p>
              </div>
              <div className="flex gap-8 text-center shrink-0">
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Productos</p>
                  <p className="text-3xl font-bold tabular-nums">{quotation.quotation_items.length}</p>
                </div>
                {quotation.total_amount > 0 && (
                  <>
                    <div className="w-px bg-border" />
                    <div>
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Subtotal est.</p>
                      <p className="text-2xl font-bold tabular-nums">
                        ${quotation.total_amount.toLocaleString('es-MX', { minimumFractionDigits: 2 })}
                      </p>
                    </div>
                  </>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Already-processed banner */}
        {alreadyProcessed && (
          <Card
            className={`shadow-md border-2 ${
              quotation.status === 'approved' || quotation.status === 'converted_to_order'
                ? 'border-green-400 bg-green-50 dark:bg-green-950/20 dark:border-green-700'
                : 'border-red-400 bg-red-50 dark:bg-red-950/20 dark:border-red-700'
            }`}
          >
            <CardContent className="pt-4 pb-4 text-center">
              <p className={`font-semibold text-sm ${
                quotation.status === 'approved' || quotation.status === 'converted_to_order'
                  ? 'text-green-700 dark:text-green-400'
                  : 'text-red-700 dark:text-red-400'
              }`}>
                {quotation.status === 'approved' || quotation.status === 'converted_to_order'
                  ? '✓ Esta cotización ya fue aprobada'
                  : '✗ Esta cotización fue rechazada'}
              </p>
            </CardContent>
          </Card>
        )}

        {/* Approved counter */}
        {isEditable && (
          <div className="grid grid-cols-2 gap-4">
            <Card className="shadow-md border border-slate-200 dark:border-zinc-700">
              <CardContent className="pt-4 pb-4 text-center">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
                  Aprobados
                </p>
                <p className="text-3xl font-bold text-green-600 dark:text-green-400 tabular-nums">{approvedCount}</p>
              </CardContent>
            </Card>
            <Card className="shadow-md border border-slate-200 dark:border-zinc-700">
              <CardContent className="pt-4 pb-4 text-center">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
                  No aprobados
                </p>
                <p className="text-3xl font-bold text-slate-400 dark:text-zinc-500 tabular-nums">{notApprovedCount}</p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Products table */}
        <Card className="shadow-lg border border-slate-200 dark:border-zinc-700 overflow-hidden">
          <CardHeader className="border-b border-slate-100 dark:border-zinc-700">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-slate-800 dark:text-zinc-100">
                <Package className="h-5 w-5 text-slate-600 dark:text-zinc-400" />
                Productos de la cotización
              </CardTitle>
              {isEditable && (
                <Button size="sm" variant="outline" onClick={handleApproveAll}
                  className="border-slate-300 dark:border-zinc-600 hover:bg-slate-100 dark:hover:bg-zinc-800">
                  <CheckSquare className="h-4 w-4 mr-1.5" />
                  Aprobar todos
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-4">
            <div className="overflow-x-auto rounded-md border border-slate-100 dark:border-zinc-700">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50 dark:bg-zinc-800/60 hover:bg-slate-50 dark:hover:bg-zinc-800/60">
                    <TableHead className="font-semibold text-slate-600 dark:text-zinc-300">ETM</TableHead>
                    <TableHead className="font-semibold text-slate-600 dark:text-zinc-300">Descripción</TableHead>
                    <TableHead className="font-semibold text-slate-600 dark:text-zinc-300">Código</TableHead>
                    <TableHead className="font-semibold text-slate-600 dark:text-zinc-300">Marca</TableHead>
                    <TableHead className="text-right font-semibold text-slate-600 dark:text-zinc-300">Precio unit.</TableHead>
                    <TableHead className="text-right font-semibold text-slate-600 dark:text-zinc-300">Cant.</TableHead>
                    <TableHead className="text-right font-semibold text-slate-600 dark:text-zinc-300">Subtotal</TableHead>
                    <TableHead className="font-semibold text-slate-600 dark:text-zinc-300 whitespace-nowrap">Entrega</TableHead>
                    <TableHead className="text-center font-semibold text-slate-600 dark:text-zinc-300 min-w-[140px]">
                      Aprobación
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {quotation.quotation_items.map((item, index) => {
                    const dec      = decisions.find((d) => d.item_id === item.id)
                    const approved = dec?.is_approved ?? false
                    const subtotal =
                      item.unit_price != null && item.quantity != null
                        ? item.unit_price * item.quantity
                        : null

                    return (
                      <TableRow
                        key={item.id}
                        className={`transition-colors border-b border-slate-100 dark:border-zinc-800 ${
                          isEditable && approved
                            ? 'bg-green-50/70 hover:bg-green-50 dark:bg-green-950/20 dark:hover:bg-green-950/30'
                            : index % 2 === 0
                              ? 'bg-white dark:bg-zinc-900 hover:bg-slate-50/80 dark:hover:bg-zinc-800/50'
                              : 'bg-slate-50/40 dark:bg-zinc-800/30 hover:bg-slate-50/80 dark:hover:bg-zinc-800/50'
                        }`}
                      >
                        <TableCell className="font-mono text-xs font-semibold text-slate-600 dark:text-zinc-400">
                          {item.etm || '—'}
                        </TableCell>
                        <TableCell className="max-w-52">
                          {item.description ? (
                            <span className="truncate block font-medium" title={item.description}>
                              {item.description}
                            </span>
                          ) : item.description_es ? (
                            <span className="truncate block text-muted-foreground italic" title={item.description_es}>
                              {item.description_es}
                            </span>
                          ) : (
                            <span className="text-muted-foreground text-xs italic">—</span>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-slate-500 dark:text-zinc-400">
                          {item.model_code || <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="text-sm">
                          {item.brand
                            ? <span className="font-medium">{item.brand}</span>
                            : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-sm">
                          {item.unit_price != null
                            ? `$${item.unit_price.toLocaleString('es-MX', { minimumFractionDigits: 2 })}`
                            : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-sm font-medium">
                          {item.quantity ?? <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-semibold text-sm">
                          {subtotal != null
                            ? `$${subtotal.toLocaleString('es-MX', { minimumFractionDigits: 2 })}`
                            : <span className="text-muted-foreground font-normal">—</span>}
                        </TableCell>
                        <TableCell className="text-sm whitespace-nowrap">
                          {item.delivery_time
                            ? DELIVERY_TIME_LABELS[item.delivery_time as DeliveryTime] ?? item.delivery_time
                            : <span className="text-muted-foreground">—</span>}
                        </TableCell>

                        {/* Approval cell */}
                        <TableCell className="text-center">
                          {isEditable ? (
                            <Button
                              size="sm"
                              variant={approved ? 'default' : 'outline'}
                              className={`h-8 px-3 text-xs font-semibold transition-all ${
                                approved
                                  ? 'bg-green-600 hover:bg-green-700 border-green-600 shadow-sm'
                                  : 'border-slate-300 dark:border-zinc-600 hover:border-green-500 hover:text-green-700 hover:bg-green-50 dark:hover:border-green-500 dark:hover:text-green-400 dark:hover:bg-green-950/30'
                              }`}
                              onClick={() => toggleDecision(item.id)}
                            >
                              <CheckCircle className="h-3.5 w-3.5 mr-1.5" />
                              {approved ? 'Aprobado' : 'Aprobar'}
                            </Button>
                          ) : (
                            item.is_approved === true ? (
                              <Badge className="bg-green-100 text-green-800 border border-green-300 dark:bg-green-900/30 dark:text-green-400 dark:border-green-700">
                                <CheckCircle className="h-3 w-3 mr-1" /> Aprobado
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-muted-foreground border-slate-300 dark:border-zinc-600">
                                <XCircle className="h-3 w-3 mr-1" /> No aprobado
                              </Badge>
                            )
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>

                {/* Approved subtotal footer */}
                {isEditable && approvedTotal > 0 && (
                  <TableFooter>
                    <TableRow className="bg-slate-50 dark:bg-zinc-800/60 hover:bg-slate-50 dark:hover:bg-zinc-800/60">
                      <TableCell colSpan={7} className="text-right font-bold text-slate-600 dark:text-zinc-300">
                        Total aprobado:
                      </TableCell>
                      <TableCell className="text-right font-bold text-slate-800 dark:text-zinc-100 tabular-nums">
                        ${approvedTotal.toLocaleString('es-MX', { minimumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="bg-slate-50 dark:bg-zinc-800/60" />
                    </TableRow>
                  </TableFooter>
                )}
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Submit */}
        {isEditable && (
          <div className="flex flex-col sm:flex-row items-center justify-end gap-4 pb-4">
            <p className="text-sm text-muted-foreground">
              {approvedCount === 0
                ? 'Selecciona al menos un producto para aprobar'
                : `${approvedCount} producto${approvedCount !== 1 ? 's' : ''} seleccionado${approvedCount !== 1 ? 's' : ''}`}
            </p>
            <Button
              size="lg"
              onClick={handleSubmit}
              disabled={isSubmitting || approvedCount === 0}
              className="shadow-md px-8"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Enviando...
                </>
              ) : (
                <>
                  <Send className="mr-2 h-4 w-4" />
                  Enviar aprobación
                </>
              )}
            </Button>
          </div>
        )}

        {/* Footer */}
        <div className="text-center pb-8 pt-2">
          <p className="text-xs text-slate-400 dark:text-zinc-600">
            DYMMSA · Distribuidor autorizado URREA · Morelia, Michoacán · México
          </p>
        </div>

      </div>
    </div>
  )
}
