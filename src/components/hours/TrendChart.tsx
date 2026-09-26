'use client'

import dynamic from 'next/dynamic'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDuration, type WeekTrendPoint } from '@/lib/timesheet'
import type { ProfileShift } from '@/types/database'

const TrendBars = dynamic(() => import('./TrendBars'), { ssr: false, loading: () => <Skeleton className="h-56 w-full" /> })

interface TrendChartProps {
  trend: WeekTrendPoint[] | undefined
  shift: ProfileShift | null | undefined
  /** Monday of the week the stepper shows; highlighted in the chart. */
  currentStart: string
  isLoading?: boolean
  isError?: boolean
}

/** Weekly totals of the last weeks against the weekly references. */
export function TrendChart({ trend, shift, currentStart, isLoading, isError }: TrendChartProps) {
  const weeks = trend?.length ?? 0
  const average = trend && weeks > 0 ? trend.reduce((sum, w) => sum + w.minutes, 0) / weeks : null

  return (
    <Card data-testid="trend-chart" data-tour="hrs-trend">
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="text-base">Últimas {weeks || 8} semanas</CardTitle>
          <p className="text-xs text-muted-foreground">Total por semana, hasta la semana visible</p>
        </div>
        {average !== null && (
          <p className="text-right text-sm text-muted-foreground">
            Promedio <span className="font-semibold tabular-nums text-foreground">{formatDuration(average)}</span> h
          </p>
        )}
      </CardHeader>
      <CardContent>
        {isError
          ? <p className="text-sm text-muted-foreground">No se pudo cargar la tendencia. Intenta de nuevo.</p>
          : isLoading || !trend
            ? <Skeleton className="h-56 w-full" />
            : <TrendBars data={trend} shift={shift ?? null} currentStart={currentStart} />}
      </CardContent>
    </Card>
  )
}
