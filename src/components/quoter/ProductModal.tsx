'use client'

import { useEffect } from 'react'
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
import type { QuotationItemRow, DeliveryTime } from '@/types/database'

export const DELIVERY_TIME_LABELS: Record<DeliveryTime, string> = {
  immediate: 'Inmediato',
  '2_3_days': '2 a 3 días',
  '3_5_days': '3 a 5 días',
  '1_week':   '1 semana',
  '2_weeks':  '2 semanas',
  indefinite: 'Indefinido',
}

interface ProductModalProps {
  mode: 'edit' | 'create'
  item?: QuotationItemRow
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (data: Omit<QuotationItemRow, '_id'>, id?: string) => void
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
}: ProductModalProps) {
  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors },
  } = useForm<FormValues>()

  const deliveryTimeValue = watch('delivery_time')

  useEffect(() => {
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
    }
  }, [open, item, reset])

  const onSubmit = (data: FormValues) => {
    onSave(
      {
        etm:            data.etm.trim(),
        description:    data.description.trim(),
        description_es: data.description_es.trim(),
        model_code:     data.model_code.trim(),
        brand:          data.brand.trim(),
        unit_price:     data.unit_price ? parseFloat(data.unit_price) : null,
        quantity:       data.quantity   ? parseInt(data.quantity, 10) : null,
        delivery_time:  data.delivery_time,
        _inDb:          item?._inDb ?? false,
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
                ETM
                {mode === 'create' && (
                  <span className="text-destructive ml-1">*</span>
                )}
              </Label>
              <Input
                id="etm"
                placeholder="Ej: H7-ET400"
                disabled={mode === 'edit'}
                {...register('etm', { required: mode === 'create' })}
              />
              {errors.etm && (
                <p className="text-xs text-destructive">El ETM es requerido</p>
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
                placeholder="URREA"
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
                {...register('quantity')}
              />
            </div>
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
            <Button type="submit">
              {mode === 'edit' ? 'Guardar cambios' : 'Agregar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
