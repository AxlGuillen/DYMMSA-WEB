'use client'

import dynamic from 'next/dynamic'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDuration, shiftProgress, SHIFT_HOURS, SHIFT_LABELS, weekChartData, type WeekView } from '@/lib/timesheet'
import type { ProfileShift } from '@/types/database'

// recharts is code-split like the dashboard donut (OrderStatusBreakdown).
const WeekBars = dynamic(() => import('./WeekBars'), { ssr: false, loading: () => <Skeleton className="h-56 w-full" /> })

interface WeekChartProps {
  week: WeekView<unknown> | undefined
  shift: ProfileShift | null | undefined
  isLoading?: boolean
  /** Admin: the "sin jornada" hint links to Equipo. */
  canAssignShift?: boolean
}

/** Bars per day against the shift references; the headline says if the week meets the target. */
export function WeekChart({ week, shift, isLoading, canAssignShift }: WeekChartProps) {
  const progress = week ? shiftProgress(week.minutes, shift) : null
  const target = shift ? SHIFT_HOURS[shift].weekly : null

  return (
    <Card data-testid="week-chart" data-tour="hrs-week-chart">
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="text-base">Horas de la semana</CardTitle>
          <p className="text-xs text-muted-foreground">
            {shift
              ? SHIFT_LABELS[shift]
              : <>Sin jornada asignada{canAssignShift && <> · <Link href="/dashboard/hours/team" className="underline">asignar en Equipo</Link></>}</>}
          </p>
        </div>
        {week && (
          <div className="text-right">
            <p className="text-2xl font-semibold tabular-nums" data-testid="week-chart-total">
              {formatDuration(week.minutes)}
              {target !== null && <span className="text-sm font-normal text-muted-foreground"> / {target} h</span>}
            </p>
            {progress && (
              progress.missing === 0
                ? <Badge className="bg-green-500/15 text-green-700 dark:text-green-400">Cumple · {progress.pct}%</Badge>
                : <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400">Faltan {formatDuration(progress.missing)} · {progress.pct}%</Badge>
            )}
          </div>
        )}
      </CardHeader>
      <CardContent>
        {isLoading || !week
          ? <Skeleton className="h-56 w-full" />
          : <WeekBars data={weekChartData(week)} shift={shift ?? null} />}
        {week && week.open > 0 && (
          <p className="mt-2 text-xs text-amber-600">
            {week.open} checada{week.open !== 1 ? 's' : ''} sin salida: esos días no suman y se pintan aparte.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
