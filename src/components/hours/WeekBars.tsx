'use client'

// oxlint-disable-next-line react-doctor/prefer-dynamic-import -- lazy boundary: WeekChart loads this via next/dynamic
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, XAxis, YAxis } from 'recharts'
import { ChartContainer, ChartTooltip, type ChartConfig } from '@/components/ui/chart'
import { formatDuration, SHIFT_HOURS, type WeekChartPoint } from '@/lib/timesheet'
import type { ProfileShift } from '@/types/database'

const config = {
  hours: { label: 'Horas', color: 'var(--chart-1)' },
  open: { label: 'Sin salida', color: 'var(--chart-4)' },
} satisfies ChartConfig

interface TooltipProps {
  active?: boolean
  payload?: { payload: WeekChartPoint }[]
}

function DayTooltip({ active, payload }: TooltipProps) {
  const point = payload?.[0]?.payload
  if (!active || !point) return null
  return (
    <div className="rounded-lg border bg-background px-3 py-2 shadow-md">
      <p className="text-sm font-medium">{point.label}</p>
      <p className="text-xs text-muted-foreground">{formatDuration(point.hours * 60)} h</p>
      {point.open > 0 && (
        <p className="text-xs text-amber-600">{point.open} sin salida — no suma</p>
      )}
    </div>
  )
}

/** Reference line for one shift: solid when it is the person's own, dashed otherwise. */
function ShiftLine({ shift, own, label }: { shift: ProfileShift; own: boolean; label: string }) {
  return (
    <ReferenceLine
      y={SHIFT_HOURS[shift].daily}
      stroke={own ? 'var(--primary)' : 'var(--muted-foreground)'}
      strokeDasharray={own ? undefined : '4 4'}
      strokeWidth={own ? 2 : 1}
      label={{ value: label, position: 'insideTopRight', fontSize: 11, fill: own ? 'var(--primary)' : 'var(--muted-foreground)' }}
    />
  )
}

export default function WeekBars({ data, shift }: { data: WeekChartPoint[]; shift: ProfileShift | null }) {
  const max = Math.max(9, ...data.map((d) => d.hours + 1))
  return (
    <ChartContainer config={config} className="h-56 w-full aspect-auto">
      <BarChart data={data} margin={{ top: 12, right: 8, left: -20, bottom: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} />
        <YAxis domain={[0, max]} tickLine={false} axisLine={false} width={40} unit=" h" />
        <ChartTooltip cursor={{ fill: 'var(--muted)' }} content={<DayTooltip />} />
        <ShiftLine shift="part_time" own={shift === 'part_time'} label="Medio tiempo (4 h)" />
        <ShiftLine shift="full_time" own={shift === 'full_time'} label="Tiempo completo (8 h)" />
        <Bar dataKey="hours" radius={4} maxBarSize={40}>
          {data.map((d) => (
            <Cell key={d.date} fill={d.open > 0 ? 'var(--color-open)' : 'var(--color-hours)'} />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  )
}
