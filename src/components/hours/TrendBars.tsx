'use client'

// oxlint-disable-next-line react-doctor/prefer-dynamic-import -- lazy boundary: TrendChart loads this via next/dynamic
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, XAxis, YAxis } from 'recharts'
import { ChartContainer, ChartTooltip, type ChartConfig } from '@/components/ui/chart'
import { formatDayMonth } from '@/lib/format'
import { formatDuration, SHIFT_HOURS, type WeekTrendPoint } from '@/lib/timesheet'
import { shiftLineProps } from './shift-line'
import type { ProfileShift } from '@/types/database'

const config = {
  hours: { label: 'Horas', color: 'var(--chart-1)' },
  current: { label: 'Semana visible', color: 'var(--chart-2)' },
} satisfies ChartConfig

interface TooltipProps {
  active?: boolean
  payload?: { payload: WeekTrendPoint }[]
}

function WeekTooltip({ active, payload }: TooltipProps) {
  const point = payload?.[0]?.payload
  if (!active || !point) return null
  return (
    <div className="rounded-lg border bg-background px-3 py-2 shadow-md">
      <p className="text-sm font-medium">{formatDayMonth(point.start)} – {formatDayMonth(point.end)}</p>
      <p className="text-xs text-muted-foreground">{formatDuration(point.minutes)} h</p>
      {point.open > 0 && <p className="text-xs text-amber-600">{point.open} sin salida</p>}
    </div>
  )
}

function ShiftLine({ shift, own, label }: { shift: ProfileShift; own: boolean; label: string }) {
  return <ReferenceLine {...shiftLineProps(SHIFT_HOURS[shift].weekly, own, label)} />
}

export default function TrendBars({ data, shift, currentStart }: { data: WeekTrendPoint[]; shift: ProfileShift | null; currentStart: string }) {
  const max = Math.max(44, ...data.map((d) => d.hours + 4))
  return (
    <ChartContainer config={config} className="h-56 w-full aspect-auto">
      <BarChart data={data} margin={{ top: 12, right: 8, left: -20, bottom: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="start" tickLine={false} axisLine={false} tickFormatter={formatDayMonth} />
        <YAxis domain={[0, max]} tickLine={false} axisLine={false} width={40} unit=" h" />
        <ChartTooltip cursor={{ fill: 'var(--muted)' }} content={<WeekTooltip />} />
        <ShiftLine shift="part_time" own={shift === 'part_time'} label="Medio tiempo (20 h)" />
        <ShiftLine shift="full_time" own={shift === 'full_time'} label="Tiempo completo (40 h)" />
        <Bar dataKey="hours" radius={4} maxBarSize={36}>
          {data.map((d) => (
            <Cell key={d.start} fill={d.start === currentStart ? 'var(--color-current)' : 'var(--color-hours)'} />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  )
}
