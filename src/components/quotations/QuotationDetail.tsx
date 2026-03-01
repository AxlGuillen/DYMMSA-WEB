'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft,
  Send,
  Copy,
  Check,
  Pencil,
  Trash2,
  Plus,
  Loader2,
  Package,
  CheckCircle2,
  XCircle,
  Clock,
  ShoppingCart,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { QuotationStatusBadge } from './QuotationStatusBadge'
import { ProductModal } from '@/components/quoter/ProductModal'
import { useSendForApproval, useUpdateQuotation, useCreateOrderFromQuotation } from '@/hooks/useQuotations'
import type { QuotationWithItems, QuotationItem, QuotationItemRow } from '@/types/database'

// ------------------------------------------------------------------ //
// Helpers                                                             //
// ------------------------------------------------------------------ //

const toItemRow = (item: QuotationItem): QuotationItemRow => ({
  _id:            item.id,
  etm:            item.etm            ?? '',
  description:    item.description    ?? '',
  description_es: item.description_es ?? '',
  model_code:     item.model_code     ?? '',
  brand:          item.brand          ?? '',
  unit_price:     item.unit_price,
  quantity:       item.quantity,
  _inDb:          !!(item.model_code || item.description),
})

const isMissingData     = (item: QuotationItemRow) => !item.description && !item.model_code
const isMissingQuantity = (item: QuotationItemRow) => !isMissingData(item) && item.quantity == null

const getRowClass = (item: QuotationItemRow) => {
  if (isMissingData(item))     return 'bg-orange-50 dark:bg-orange-950/20'
  if (isMissingQuantity(item)) return 'bg-yellow-50 dark:bg-yellow-950/20'
  return ''
}

// ------------------------------------------------------------------ //
// Component                                                           //
// ------------------------------------------------------------------ //

interface QuotationDetailProps {
  quotation: QuotationWithItems
}

export function QuotationDetail({ quotation }: QuotationDetailProps) {
  const router = useRouter()

  // ── Draft editing state ─────────────────────────────────────────
  const [localName, setLocalName]   = useState(quotation.customer_name)
  const [localItems, setLocalItems] = useState<QuotationItemRow[]>(
    quotation.quotation_items.map(toItemRow)
  )
  const [isDirty, setIsDirty] = useState(false)

  // Modal state
  const [modalOpen, setModalOpen]       = useState(false)
  const [modalMode, setModalMode]       = useState<'edit' | 'create'>('create')
  const [selectedItem, setSelectedItem] = useState<QuotationItemRow | undefined>()

  // Copy-link state
  const [copied, setCopied] = useState(false)

  const sendForApproval        = useSendForApproval()
  const updateQuotation        = useUpdateQuotation()
  const createOrderMutation    = useCreateOrderFromQuotation()

  const isDraft            = quotation.status === 'draft'
  const isSentForApproval  = quotation.status === 'sent_for_approval'
  const isApproved         = quotation.status === 'approved'
  const isConvertedToOrder = quotation.status === 'converted_to_order'

  // Keep local state in sync if quotation data reloads
  useEffect(() => {
    setLocalName(quotation.customer_name)
    setLocalItems(quotation.quotation_items.map(toItemRow))
    setIsDirty(false)
  }, [quotation.id])

  // ── Item editing handlers ───────────────────────────────────────
  const handleEdit = (item: QuotationItemRow) => {
    setSelectedItem(item)
    setModalMode('edit')
    setModalOpen(true)
  }

  const handleCreate = () => {
    setSelectedItem(undefined)
    setModalMode('create')
    setModalOpen(true)
  }

  const handleModalSave = (data: Omit<QuotationItemRow, '_id'>, id?: string) => {
    if (id) {
      setLocalItems((prev) =>
        prev.map((item) => (item._id === id ? { ...item, ...data } : item))
      )
    } else {
      setLocalItems((prev) => [...prev, { ...data, _id: crypto.randomUUID() }])
    }
    setIsDirty(true)
  }

  const handleRemove = (id: string) => {
    setLocalItems((prev) => prev.filter((item) => item._id !== id))
    setIsDirty(true)
  }

  // ── Save changes ────────────────────────────────────────────────
  const handleSave = async () => {
    try {
      await updateQuotation.mutateAsync({
        id:            quotation.id,
        customer_name: localName,
        items:         localItems,
      })
      setIsDirty(false)
      toast.success('Cotización actualizada')
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al guardar')
    }
  }

  // ── Send for approval ───────────────────────────────────────────
  const handleSendForApproval = async () => {
    try {
      // Save pending changes first
      if (isDirty) {
        await updateQuotation.mutateAsync({
          id:            quotation.id,
          customer_name: localName,
          items:         localItems,
        })
        setIsDirty(false)
      }
      await sendForApproval.mutateAsync(quotation.id)
      toast.success('Cotización enviada a aprobación')
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al enviar')
    }
  }

  // ── Copy approval link ──────────────────────────────────────────
  const approvalUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/approve/${quotation.approval_token}`
    : ''

  const handleCopyLink = async () => {
    await navigator.clipboard.writeText(approvalUrl)
    setCopied(true)
    toast.success('Link copiado al portapapeles')
    setTimeout(() => setCopied(false), 2000)
  }

  // ── Create order from approved quotation ────────────────────────
  const handleCreateOrder = async () => {
    try {
      const result = await createOrderMutation.mutateAsync(quotation.id)
      toast.success(`Orden creada con ${result.items_count} producto(s)`)
      router.push(`/dashboard/orders/${result.order_id}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al generar la orden')
    }
  }

  // ── Stats ───────────────────────────────────────────────────────
  const items     = isDraft ? localItems : quotation.quotation_items.map(toItemRow)
  const partialTotal = items.reduce((sum, item) => {
    if (item.unit_price != null && item.quantity != null) {
      return sum + item.unit_price * item.quantity
    }
    return sum
  }, 0)

  const approvedCount  = quotation.quotation_items.filter((i) => i.is_approved === true).length
  const rejectedCount  = quotation.quotation_items.filter((i) => i.is_approved === false).length
  const pendingCount   = quotation.quotation_items.filter((i) => i.is_approved === null).length
  const noDataCount    = isDraft ? localItems.filter(isMissingData).length : 0
  const noQuantityCount= isDraft ? localItems.filter(isMissingQuantity).length : 0

  const canSendForApproval = localName.trim().length > 0 && localItems.length > 0

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => router.push('/dashboard/quotations')}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">
              {isDraft ? localName || 'Sin nombre' : quotation.customer_name}
            </h1>
            <QuotationStatusBadge status={quotation.status} />
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            #{quotation.id.slice(0, 8)} · Creada el{' '}
            {new Date(quotation.created_at).toLocaleDateString('es-MX', {
              day: '2-digit', month: 'long', year: 'numeric',
            })}
          </p>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2">
          {isDraft && (
            <>
              {isDirty && (
                <Button
                  variant="outline"
                  onClick={handleSave}
                  disabled={updateQuotation.isPending}
                >
                  {updateQuotation.isPending
                    ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    : null}
                  Guardar cambios
                </Button>
              )}
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button disabled={!canSendForApproval || sendForApproval.isPending || updateQuotation.isPending}>
                    <Send className="mr-2 h-4 w-4" />
                    Enviar a aprobación
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>¿Enviar a aprobación?</AlertDialogTitle>
                    <AlertDialogDescription>
                      {isDirty
                        ? 'Se guardarán los cambios pendientes y se enviará la cotización al aprobador. Una vez enviada no podrás editar los productos.'
                        : 'Se enviará la cotización al aprobador. Una vez enviada no podrás editar los productos.'}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction onClick={handleSendForApproval}>
                      Sí, enviar
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}

          {isSentForApproval && (
            <Button variant="outline" onClick={handleCopyLink}>
              {copied
                ? <Check className="mr-2 h-4 w-4 text-green-500" />
                : <Copy className="mr-2 h-4 w-4" />}
              {copied ? 'Copiado' : 'Copiar link de aprobación'}
            </Button>
          )}

          {isApproved && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  className="bg-green-600 hover:bg-green-700"
                  disabled={createOrderMutation.isPending}
                >
                  {createOrderMutation.isPending
                    ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    : <ShoppingCart className="mr-2 h-4 w-4" />}
                  Generar Orden
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>¿Generar orden de venta?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Se creará una orden con los{' '}
                    {quotation.quotation_items.filter((i) => i.is_approved === true).length}{' '}
                    productos aprobados. Se verificará el stock disponible y se descontará
                    automáticamente del inventario. Esta acción no se puede deshacer.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-green-600 hover:bg-green-700"
                    onClick={handleCreateOrder}
                  >
                    Sí, generar orden
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>

      {/* Approval link banner */}
      {isSentForApproval && (
        <Card className="border-blue-200 bg-blue-50 dark:bg-blue-950/20 dark:border-blue-800">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-blue-800 dark:text-blue-300 mb-1">
                  Link de aprobación
                </p>
                <p className="text-xs text-blue-700 dark:text-blue-400 font-mono truncate">
                  {approvalUrl}
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={handleCopyLink}>
                {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-xs text-muted-foreground">Productos</p>
            <p className="text-2xl font-bold">{isDraft ? localItems.length : quotation.quotation_items.length}</p>
          </CardContent>
        </Card>

        {/* Draft: show completeness stats */}
        {isDraft && (
          <>
            <Card className={noQuantityCount > 0 ? 'border-yellow-300 dark:border-yellow-700' : ''}>
              <CardContent className="pt-4 pb-4">
                <p className="text-xs text-muted-foreground">Sin cantidad</p>
                <p className={`text-2xl font-bold ${noQuantityCount > 0 ? 'text-yellow-600 dark:text-yellow-400' : 'text-muted-foreground'}`}>
                  {noQuantityCount}
                </p>
              </CardContent>
            </Card>
            <Card className={noDataCount > 0 ? 'border-orange-300 dark:border-orange-700' : ''}>
              <CardContent className="pt-4 pb-4">
                <p className="text-xs text-muted-foreground">Sin datos</p>
                <p className={`text-2xl font-bold ${noDataCount > 0 ? 'text-orange-600 dark:text-orange-400' : 'text-muted-foreground'}`}>
                  {noDataCount}
                </p>
              </CardContent>
            </Card>
          </>
        )}

        {/* Approved: show approval stats */}
        {(isApproved || isSentForApproval) && (
          <>
            <Card>
              <CardContent className="pt-4 pb-4">
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3 text-green-500" /> Aprobados
                </p>
                <p className="text-2xl font-bold text-green-600">{approvedCount}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-4">
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <XCircle className="h-3 w-3 text-red-500" /> Rechazados
                </p>
                <p className="text-2xl font-bold text-red-500">{rejectedCount}</p>
              </CardContent>
            </Card>
          </>
        )}

        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-xs text-muted-foreground">Total</p>
            <p className="text-xl font-bold">
              {partialTotal > 0
                ? `$${partialTotal.toLocaleString('es-MX', { minimumFractionDigits: 2 })}`
                : <span className="text-muted-foreground text-base">Sin precio</span>}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Customer name input (draft only) */}
      {isDraft && (
        <div className="max-w-sm space-y-1.5">
          <Label htmlFor="customer_name">Nombre del cliente <span className="text-destructive">*</span></Label>
          <Input
            id="customer_name"
            value={localName}
            onChange={(e) => { setLocalName(e.target.value); setIsDirty(true) }}
            placeholder="Ej: Constructora ABC"
          />
        </div>
      )}

      {/* Products section */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Package className="h-5 w-5" />
                Productos
              </CardTitle>
              {isDraft && (
                <CardDescription>
                  Agrega, edita o elimina productos antes de enviar a aprobación
                </CardDescription>
              )}
            </div>
            {isDraft && (
              <Button size="sm" onClick={handleCreate}>
                <Plus className="h-4 w-4 mr-1.5" />
                Agregar
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
                  {(isApproved || isSentForApproval) && (
                    <TableHead className="text-center">Aprobación</TableHead>
                  )}
                  {isDraft && (
                    <TableHead className="text-center">Acciones</TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow
                    key={item._id}
                    className={`border-b border-border/60 ${getRowClass(item)}`}
                  >
                    <TableCell className="font-mono text-xs font-medium">{item.etm || '—'}</TableCell>
                    <TableCell className="max-w-52">
                      {item.description
                        ? <span className="truncate block" title={item.description}>{item.description}</span>
                        : <span className="text-muted-foreground italic text-xs">Sin descripción</span>
                      }
                    </TableCell>
                    <TableCell className="font-mono text-xs">{item.model_code || <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell>{item.brand || <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {item.unit_price != null
                        ? `$${item.unit_price.toLocaleString('es-MX', { minimumFractionDigits: 2 })}`
                        : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {item.quantity ?? <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {item.unit_price != null && item.quantity != null
                        ? `$${(item.unit_price * item.quantity).toLocaleString('es-MX', { minimumFractionDigits: 2 })}`
                        : <span className="text-muted-foreground">—</span>}
                    </TableCell>

                    {/* Approval column */}
                    {(isApproved || isSentForApproval) && (
                      <TableCell className="text-center">
                        {(() => {
                          const dbItem = quotation.quotation_items.find((i) => i.id === item._id)
                          if (!dbItem) return null
                          if (dbItem.is_approved === true)
                            return <Badge variant="outline" className="text-xs text-green-600 border-green-300"><CheckCircle2 className="h-3 w-3 mr-1" />Aprobado</Badge>
                          if (dbItem.is_approved === false)
                            return <Badge variant="outline" className="text-xs text-red-600 border-red-300"><XCircle className="h-3 w-3 mr-1" />Rechazado</Badge>
                          return <Badge variant="outline" className="text-xs text-muted-foreground"><Clock className="h-3 w-3 mr-1" />Pendiente</Badge>
                        })()}
                      </TableCell>
                    )}

                    {/* Edit/Delete (draft only) */}
                    {isDraft && (
                      <TableCell>
                        <div className="flex items-center justify-center gap-1">
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleEdit(item)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon" variant="ghost"
                            className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                            onClick={() => handleRemove(item._id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>

              {partialTotal > 0 && (
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={isDraft ? 6 : (isApproved || isSentForApproval) ? 7 : 6} className="text-right font-bold">
                      Total{partialTotal < items.reduce((s, i) => s + (i.unit_price ?? 0) * (i.quantity ?? 0), 0) ? ' parcial' : ''}:
                    </TableCell>
                    <TableCell className="text-right font-bold">
                      ${partialTotal.toLocaleString('es-MX', { minimumFractionDigits: 2 })}
                    </TableCell>
                    {(isDraft || isApproved || isSentForApproval) && <TableCell />}
                  </TableRow>
                </TableFooter>
              )}
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Product modal (draft editing) */}
      {isDraft && (
        <ProductModal
          mode={modalMode}
          item={selectedItem}
          open={modalOpen}
          onOpenChange={setModalOpen}
          onSave={handleModalSave}
        />
      )}

    </div>
  )
}
