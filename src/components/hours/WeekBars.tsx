'use client'

// oxlint-disable-next-line react-doctor/prefer-dynamic-import -- lazy boundary: WeekChart loads this via next/dynamic
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, XAxis, YAxis } from 'recharts'
import { ChartContainer, ChartTooltip, type ChartConfig } from '@/components/ui/chart'
import { EXCUSE_LABELS, formatDuration, SHIFT_HOURS, type DayStatus, type WeekChartPoint } from '@/lib/timesheet'
import { shiftLineProps } from './shift-line'
import type { ProfileShift } from '@/types/database'

const config = {
  hours: { label: 'Horas', color: 'var(--chart-1)' },
  open: { label: 'Sin salida', color: 'var(--chart-4)' },
  // Literal oklch: Tailwind v4 only emits the palette variables a class uses.
  met: { label: 'Cumplió', color: 'oklch(62.7% 0.194 149.214)' },
  short: { label: 'No cumplió', color: 'oklch(57.7% 0.245 27.325)' },
  excused: { label: 'Justificado', color: 'oklch(87.1% 0.15 154.449)' },
} satisfies ChartConfig

const FILL: Record<DayStatus, string> = {
  met: 'var(--color-met)',
  short: 'var(--color-short)',
  excused: 'var(--color-excused)',
  open: 'var(--color-open)',
  pending: 'var(--color-hours)',
  off: 'var(--color-hours)',
}

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
      <p className="text-xs text-muted-foreground">{formatDuration(point.minutes)} h</p>
      {point.status === 'met' && <p className="text-xs text-green-700 dark:text-green-400">Cumplió su jornada</p>}
      {point.status === 'short' && <p className="text-xs text-red-600">Faltaron {formatDuration(point.missing)} h</p>}
      {point.excuse && <p className="text-xs text-green-700 dark:text-green-400">{EXCUSE_LABELS[point.excuse]} — no cuenta como faltante</p>}
      {point.open > 0 && (
        <p className="text-xs text-amber-600">{point.open} sin salida — no suma</p>
      )}
    </div>
  )
}

function ShiftLine({ shift, own, label }: { shift: ProfileShift; own: boolean; label: string }) {
  return <ReferenceLine {...shiftLineProps(SHIFT_HOURS[shift].daily, own, label)} />
}

export default function WeekBars({ data, shift }: { data: WeekChartPoint[]; shift: ProfileShift | null }) {
  const max = Math.max(9, ...data.map((d) => d.hours + 1))
  return (
    <ChartContainer config={config} className="h-56 w-full aspect-auto">
      <BarChart data={data} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} />
        <YAxis domain={[0, max]} tickLine={false} axisLine={false} width={44} allowDecimals={false} unit=" h" />
        <ChartTooltip cursor={{ fill: 'var(--muted)' }} content={<DayTooltip />} />
        <ShiftLine shift="part_time" own={shift === 'part_time'} label="Medio tiempo (4 h)" />
        <ShiftLine shift="full_time" own={shift === 'full_time'} label="Tiempo completo (8 h)" />
        {/* A short day with no hours still shows a red sliver instead of vanishing. */}
        <Bar dataKey="hours" radius={4} maxBarSize={40} minPointSize={(_value, index) => (data[index]?.status === 'short' ? 3 : 0)}>
          {data.map((d) => (
            <Cell key={d.date} fill={FILL[d.status]} />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  )
}
