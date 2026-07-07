'use client'

import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Loader2 } from 'lucide-react'
import { parseNumber, parseInteger } from '@/lib/format'
import type { QuotationItemRow, DeliveryTime } from '@/types/database'
import { DELIVERY_TIME_LABELS } from '@/lib/delivery'

const EMPTY_ETMS: string[] = []

interface ProductModalProps {
  mode: 'edit' | 'create'
  item?: QuotationItemRow
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (data: Omit<QuotationItemRow, '_id'>, id?: string) => void
  existingEtms?: string[]
}

interface FormValues {
  etm: string
  description: string
  description_es: string
  model_code: string
  brand: string
  unit_price: string
  quantity: string
  delivery_time: DeliveryTime
}

export function ProductModal({
  mode,
  item,
  open,
  onOpenChange,
  onSave,
  existingEtms = EMPTY_ETMS,
}: ProductModalProps) {
  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    getValues,
    formState: { errors },
  } = useForm<FormValues>()

  const deliveryTimeValue = watch('delivery_time')

  const [etmError, setEtmError]           = useState<string | null>(null)
  const [isCheckingEtm, setIsCheckingEtm] = useState(false)
  // is_sold es tri-estado ('sin definir' | 'sí' | 'no') → se maneja aparte de RHF.
  const [isSold, setIsSold] = useState<boolean | null>(null)

  useEffect(() => {
    // oxlint-disable-next-line react-doctor/no-event-handler -- intentional pattern; structural refactor tracked separately
    if (open) {
      reset({
        etm:            item?.etm            ?? '',
        description:    item?.description    ?? '',
        description_es: item?.description_es ?? '',
        model_code:     item?.model_code     ?? '',
        brand:          item?.brand          ?? '',
        unit_price:     item?.unit_price != null ? String(item.unit_price) : '',
        quantity:       item?.quantity    != null ? String(item.quantity)   : '',
        delivery_time:  item?.delivery_time  ?? 'immediate',
      })
      // oxlint-disable-next-line react-doctor/no-adjust-state-on-prop-change -- intentional pattern; structural refactor tracked separately
      setEtmError(null)
      setIsSold(item?.is_sold ?? null)
    }
  }, [open, item, reset])

  const notSold = isSold === false

  const validateEtm = async (value: string): Promise<string | null> => {
    const trimmed = value.trim()
    if (!trimmed) return 'El ETM es requerido'

    // Skip DB check if ETM is unchanged in edit mode
    if (mode === 'edit' && trimmed === item?.etm) return null

    // Check for duplicates within the current quotation
    if (existingEtms.includes(trimmed)) return 'Este ETM ya existe en la cotización'

    // Check against DB
    try {
      const resp = await fetch('/api/quotes/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ etmCodes: [trimmed] }),
      })
      const { found } = await resp.json()
      if (found.length > 0) return 'Este ETM ya existe en el catálogo'
    } catch {
      // On network error don't block the user
    }

    return null
  }

  const handleEtmBlur = async () => {
    const value = getValues('etm')
    setIsCheckingEtm(true)
    const error = await validateEtm(value)
    setEtmError(error)
    setIsCheckingEtm(false)
  }

  const onSubmit = async (data: FormValues) => {
    setIsCheckingEtm(true)
    const error = await validateEtm(data.etm)
    setIsCheckingEtm(false)
    if (error) {
      setEtmError(error)
      return
    }
    setEtmError(null)

    onSave(
      {
        item_type:      'product',
        section_label:  '',
        etm:            data.etm.trim(),
        description:    data.description.trim(),
        description_es: data.description_es.trim(),
        model_code:     data.model_code.trim(),
        brand:          data.brand.trim(),
        unit_price:     parseNumber(data.unit_price),
        quantity:       parseInteger(data.quantity),
        delivery_time:  data.delivery_time,
        _inDb:          item?._inDb ?? false,
        is_sold:        isSold,
      },
      item?._id
    )
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <DialogTitle>
              {mode === 'edit' ? 'Editar producto' : 'Agregar producto'}
            </DialogTitle>
            {item?._inDb && (
              <Badge variant="secondary">En catálogo</Badge>
            )}
            {item && !item._inDb && (
              <Badge variant="outline" className="text-amber-600 border-amber-300">
                Nuevo
              </Badge>
            )}
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="etm">
                ETM <span className="text-destructive">*</span>
              </Label>
              <Input
                id="etm"
                placeholder="Ej: H7-ET400"
                {...register('etm', { required: true })}
                onBlur={handleEtmBlur}
              />
              {(errors.etm || etmError) && (
                <p className="text-xs text-destructive">
                  {etmError ?? 'El ETM es requerido'}
                </p>
              )}
              {isCheckingEtm && (
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Loader2 className="size-3 animate-spin" /> Verificando…
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="model_code">Código Modelo</Label>
              <Input
                id="model_code"
                placeholder="Ej: 95040"
                {...register('model_code')}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="description">Descripción</Label>
            <Input
              id="description"
              placeholder="Descripción en inglés"
              {...register('description')}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="description_es">Descripción ES</Label>
            <Input
              id="description_es"
              placeholder="Descripción en español"
              {...register('description_es')}
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="brand">Marca</Label>
              <Input
                id="brand"
                placeholder="Ej: URREA"
                {...register('brand')}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="unit_price">Precio</Label>
              <Input
                id="unit_price"
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                disabled={notSold}
                {...register('unit_price')}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="quantity">Cantidad</Label>
              <Input
                id="quantity"
                type="number"
                min="1"
                step="1"
                placeholder="0"
                disabled={notSold}
                {...register('quantity')}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>¿Lo vendemos?</Label>
            <Select
              value={isSold === null ? 'undefined' : String(isSold)}
              onValueChange={(val) =>
                setIsSold(val === 'undefined' ? null : val === 'true')
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="undefined">Sin definir</SelectItem>
                <SelectItem value="true">Sí lo vendemos</SelectItem>
                <SelectItem value="false">No lo vendemos</SelectItem>
              </SelectContent>
            </Select>
            {notSold && (
              <p className="text-xs text-muted-foreground">
                Marcado como no vendible: se salta en el cotizador y no requiere precio ni cantidad.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Tiempo de entrega</Label>
            <Select
              value={deliveryTimeValue ?? 'immediate'}
              onValueChange={(val) => setValue('delivery_time', val as DeliveryTime)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Seleccionar..." />
              </SelectTrigger>
              <SelectContent>
                {(Object.entries(DELIVERY_TIME_LABELS) as [DeliveryTime, string][]).map(
                  ([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  )
                )}
              </SelectContent>
            </Select>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={isCheckingEtm}>
              {isCheckingEtm ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Verificando…
                </>
              ) : mode === 'edit' ? 'Guardar cambios' : 'Agregar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
