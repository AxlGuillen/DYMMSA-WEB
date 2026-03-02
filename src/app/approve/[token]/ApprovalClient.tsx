'use client'

import { useState } from 'react'
import {
  CheckCircle,
  XCircle,
  Clock,
  Package,
  CheckSquare,
  Send,
  Loader2,
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
import type { QuotationWithItems } from '@/types/database'

// ------------------------------------------------------------------ //
// Types                                                               //
// ------------------------------------------------------------------ //

interface ItemDecision {
  item_id: string
  is_approved: boolean | null
}

interface Props {
  quotation: QuotationWithItems
  token: string
}

// ------------------------------------------------------------------ //
// Component                                                           //
// ------------------------------------------------------------------ //

export function ApprovalClient({ quotation, token }: Props) {
  const isEditable = quotation.status === 'sent_for_approval'

  const [decisions, setDecisions] = useState<ItemDecision[]>(
    quotation.quotation_items.map((item) => ({
      item_id:     item.id,
      is_approved: item.is_approved,
    }))
  )
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitted, setSubmitted]       = useState(false)

  const approvedCount = decisions.filter((d) => d.is_approved === true).length
  const rejectedCount = decisions.filter((d) => d.is_approved === false).length
  const pendingCount  = decisions.filter((d) => d.is_approved === null).length

  const approvedTotal = quotation.quotation_items.reduce((sum, item) => {
    const dec = decisions.find((d) => d.item_id === item.id)
    if (dec?.is_approved && item.unit_price != null && item.quantity != null) {
      return sum + item.unit_price * item.quantity
    }
    return sum
  }, 0)

  const setDecision = (item_id: string, value: boolean | null) => {
    setDecisions((prev) =>
      prev.map((d) => (d.item_id === item_id ? { ...d, is_approved: value } : d))
    )
  }

  const handleApproveAll = () => {
    setDecisions((prev) => prev.map((d) => ({ ...d, is_approved: true })))
  }

  const handleSubmit = async () => {
    if (pendingCount > 0) {
      toast.warning(`Faltan ${pendingCount} producto(s) por decidir`)
      return
    }

    setIsSubmitting(true)
    try {
      const res = await fetch(`/api/approve/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decisions: decisions.map((d) => ({
            item_id:     d.item_id,
            is_approved: d.is_approved!,
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

  // ── Success screen ────────────────────────────────────────────────
  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-muted/30">
        <Card className="max-w-md w-full text-center shadow-lg">
          <CardContent className="pt-10 pb-10 space-y-4">
            <div className="flex justify-center">
              <CheckCircle className="h-16 w-16 text-green-500" />
            </div>
            <h2 className="text-2xl font-bold">¡Gracias!</h2>
            <p className="text-muted-foreground text-sm">
              Tu decisión ha sido registrada. El equipo de DYMMSA la recibirá de inmediato.
            </p>
            <div className="flex justify-center gap-6 pt-2">
              <div className="text-center">
                <p className="text-2xl font-bold text-green-600">{approvedCount}</p>
                <p className="text-xs text-muted-foreground">Aprobados</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-red-500">{rejectedCount}</p>
                <p className="text-xs text-muted-foreground">Rechazados</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  const alreadyProcessed =
    quotation.status === 'approved' ||
    quotation.status === 'rejected' ||
    quotation.status === 'converted_to_order'

  return (
    <div className="min-h-screen bg-muted/30">
      <div className="max-w-5xl mx-auto p-4 sm:p-6 lg:p-8 space-y-6">

        {/* Branding */}
        <div className="text-center space-y-1 pt-4">
          <h1 className="text-3xl font-bold tracking-tight">DYMMSA</h1>
          <p className="text-sm text-muted-foreground">Cotización para aprobación</p>
        </div>

        {/* Quotation summary */}
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="flex-1">
                <p className="text-xs text-muted-foreground">Cliente</p>
                <p className="text-xl font-semibold">{quotation.customer_name}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Enviada el{' '}
                  {new Date(quotation.created_at).toLocaleDateString('es-MX', {
                    day: '2-digit', month: 'long', year: 'numeric',
                  })}
                </p>
              </div>
              <div className="flex gap-8 text-center">
                <div>
                  <p className="text-xs text-muted-foreground">Productos</p>
                  <p className="text-2xl font-bold">{quotation.quotation_items.length}</p>
                </div>
                {quotation.total_amount > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground">Total est.</p>
                    <p className="text-xl font-bold">
                      ${quotation.total_amount.toLocaleString('es-MX', { minimumFractionDigits: 2 })}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Already-processed banner */}
        {alreadyProcessed && (
          <Card
            className={
              quotation.status === 'approved' || quotation.status === 'converted_to_order'
                ? 'border-green-300 bg-green-50 dark:bg-green-950/20 dark:border-green-800'
                : 'border-red-300 bg-red-50 dark:bg-red-950/20 dark:border-red-800'
            }
          >
            <CardContent className="pt-4 pb-4 text-center">
              <p className="font-medium text-sm">
                {quotation.status === 'approved' || quotation.status === 'converted_to_order'
                  ? '✓ Esta cotización ya fue aprobada'
                  : '✗ Esta cotización fue rechazada'}
              </p>
            </CardContent>
          </Card>
        )}

        {/* Decision counters (only while editing) */}
        {isEditable && (
          <div className="grid grid-cols-3 gap-3">
            <Card>
              <CardContent className="pt-3 pb-3 text-center">
                <p className="text-xs text-muted-foreground">Aprobados</p>
                <p className="text-2xl font-bold text-green-600">{approvedCount}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-3 pb-3 text-center">
                <p className="text-xs text-muted-foreground">Rechazados</p>
                <p className="text-2xl font-bold text-red-500">{rejectedCount}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-3 pb-3 text-center">
                <p className="text-xs text-muted-foreground">Pendientes</p>
                <p
                  className={`text-2xl font-bold ${
                    pendingCount > 0 ? 'text-amber-500' : 'text-muted-foreground'
                  }`}
                >
                  {pendingCount}
                </p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Products table */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Package className="h-5 w-5" />
                Productos
              </CardTitle>
              {isEditable && (
                <Button size="sm" variant="outline" onClick={handleApproveAll}>
                  <CheckSquare className="h-4 w-4 mr-1.5" />
                  Aprobar todos
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ETM</TableHead>
                    <TableHead>Descripción</TableHead>
                    <TableHead>Código</TableHead>
                    <TableHead>Marca</TableHead>
                    <TableHead className="text-right">Precio unit.</TableHead>
                    <TableHead className="text-right">Cant.</TableHead>
                    <TableHead className="text-right">Subtotal</TableHead>
                    <TableHead className="text-center min-w-[180px]">Decisión</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {quotation.quotation_items.map((item) => {
                    const dec       = decisions.find((d) => d.item_id === item.id)
                    const decision  = dec?.is_approved ?? null
                    const subtotal  =
                      item.unit_price != null && item.quantity != null
                        ? item.unit_price * item.quantity
                        : null

                    const rowClass = !isEditable
                      ? ''
                      : decision === true
                        ? 'bg-green-50 dark:bg-green-950/20'
                        : decision === false
                          ? 'bg-red-50 dark:bg-red-950/20'
                          : ''

                    return (
                      <TableRow key={item.id} className={`border-b border-border/60 ${rowClass}`}>
                        <TableCell className="font-mono text-xs font-medium">
                          {item.etm || '—'}
                        </TableCell>
                        <TableCell className="max-w-52">
                          {item.description ? (
                            <span className="truncate block" title={item.description}>
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
                        <TableCell className="font-mono text-xs">
                          {item.model_code || <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell>
                          {item.brand || <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {item.unit_price != null
                            ? `$${item.unit_price.toLocaleString('es-MX', { minimumFractionDigits: 2 })}`
                            : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {item.quantity ?? <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-medium">
                          {subtotal != null
                            ? `$${subtotal.toLocaleString('es-MX', { minimumFractionDigits: 2 })}`
                            : <span className="text-muted-foreground">—</span>}
                        </TableCell>

                        {/* Decision cell */}
                        <TableCell className="text-center">
                          {isEditable ? (
                            <div className="flex items-center justify-center gap-1.5">
                              <Button
                                size="sm"
                                variant={decision === true ? 'default' : 'outline'}
                                className={`h-7 px-2.5 text-xs ${
                                  decision === true
                                    ? 'bg-green-600 hover:bg-green-700 border-green-600'
                                    : 'hover:border-green-500 hover:text-green-700'
                                }`}
                                onClick={() =>
                                  setDecision(item.id, decision === true ? null : true)
                                }
                              >
                                <CheckCircle className="h-3.5 w-3.5 mr-1" />
                                Aprobar
                              </Button>
                              <Button
                                size="sm"
                                variant={decision === false ? 'default' : 'outline'}
                                className={`h-7 px-2.5 text-xs ${
                                  decision === false
                                    ? 'bg-red-600 hover:bg-red-700 border-red-600'
                                    : 'hover:border-red-400 hover:text-red-600'
                                }`}
                                onClick={() =>
                                  setDecision(item.id, decision === false ? null : false)
                                }
                              >
                                <XCircle className="h-3.5 w-3.5 mr-1" />
                                Rechazar
                              </Button>
                            </div>
                          ) : (
                            // Read-only
                            (() => {
                              if (item.is_approved === true)
                                return (
                                  <Badge className="bg-green-100 text-green-800 border-green-300 dark:bg-green-900/30 dark:text-green-400">
                                    <CheckCircle className="h-3 w-3 mr-1" /> Aprobado
                                  </Badge>
                                )
                              if (item.is_approved === false)
                                return (
                                  <Badge className="bg-red-100 text-red-800 border-red-300 dark:bg-red-900/30 dark:text-red-400">
                                    <XCircle className="h-3 w-3 mr-1" /> Rechazado
                                  </Badge>
                                )
                              return (
                                <Badge variant="outline" className="text-muted-foreground">
                                  <Clock className="h-3 w-3 mr-1" /> Pendiente
                                </Badge>
                              )
                            })()
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>

                {/* Approved subtotal footer */}
                {isEditable && approvedTotal > 0 && (
                  <TableFooter>
                    <TableRow>
                      <TableCell colSpan={6} className="text-right font-bold">
                        Total aprobado:
                      </TableCell>
                      <TableCell className="text-right font-bold">
                        ${approvedTotal.toLocaleString('es-MX', { minimumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell />
                    </TableRow>
                  </TableFooter>
                )}
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Submit */}
        {isEditable && (
          <div className="flex items-center justify-end gap-4 pb-8">
            {pendingCount > 0 && (
              <p className="text-sm text-amber-600">
                {pendingCount} producto{pendingCount !== 1 ? 's' : ''} sin decidir
              </p>
            )}
            <Button
              size="lg"
              onClick={handleSubmit}
              disabled={isSubmitting || pendingCount > 0}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Enviando...
                </>
              ) : (
                <>
                  <Send className="mr-2 h-4 w-4" />
                  Enviar decisión
                </>
              )}
            </Button>
          </div>
        )}

      </div>
    </div>
  )
}
