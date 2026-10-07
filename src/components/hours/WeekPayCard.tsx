'use client'

import { Card, CardContent } from '@/components/ui/card'
import { DollarSign } from '@/components/icons'
import { useCurrency } from '@/hooks/useCurrency'
import { officeWeekPay } from '@/lib/office-pay'
import { formatDuration, type WeekView } from '@/lib/timesheet'
import type { ProfileShift } from '@/types/database'

interface WeekPayCardProps {
  week: WeekView<unknown> | undefined
  shift: ProfileShift | null | undefined
  rate: number | null | undefined
}

/** Estimate only: the official pay is the admin's payroll cut. */
export function WeekPayCard({ week, shift, rate }: WeekPayCardProps) {
  const fmt = useCurrency()
  const pay = week ? officeWeekPay(week, shift, rate) : null
  if (!pay) return null

  return (
    <Card data-testid="week-pay">
      <CardContent className="flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="rounded-lg bg-green-500/15 p-2 text-green-700 dark:text-green-400">
            <DollarSign className="size-5" />
          </span>
          <div>
            <p className="text-sm font-medium">Pago estimado de la semana</p>
            <p className="text-xs text-muted-foreground">
              {formatDuration(pay.workedMinutes)} h trabajadas
              {pay.saturdayHours > 0 && <> + {pay.saturdayHours} h del sábado</>} × {fmt(pay.rate)} la hora
            </p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-2xl font-semibold tabular-nums" data-testid="week-pay-amount">{fmt(pay.amount)}</p>
          <p className="text-xs text-muted-foreground">Estimado; el pago oficial lo confirma la administración.</p>
        </div>
      </CardContent>
    </Card>
  )
}
