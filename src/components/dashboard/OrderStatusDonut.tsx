'use client'

// oxlint-disable-next-line react-doctor/prefer-dynamic-import -- this is the lazy boundary; recharts is code-split via next/dynamic in the parent
import { PieChart, Pie, Cell, Tooltip } from 'recharts'

interface ChartDatum {
  status: string
  name: string
  value: number
  color: string
}

interface CustomTooltipProps {
  active?: boolean
  payload?: { name: string; value: number }[]
}

function CustomTooltip({ active, payload }: CustomTooltipProps) {
  if (!active || !payload?.length) return null
  const { name, value } = payload[0]
  return (
    <div className="rounded-lg border bg-background px-3 py-2 shadow-md">
      <p className="text-sm font-medium">{name}</p>
      <p className="text-xs text-muted-foreground">
        {value} {value === 1 ? 'orden' : 'ordenes'}
      </p>
    </div>
  )
}

interface OrderStatusDonutProps {
  chartData: ChartDatum[]
  total: number
}

export default function OrderStatusDonut({ chartData, total }: OrderStatusDonutProps) {
  return (
    <div className="relative size-[200px]">
      <PieChart width={200} height={200}>
        <Pie
          data={chartData}
          cx="50%"
          cy="50%"
          innerRadius={62}
          outerRadius={90}
          paddingAngle={2}
          dataKey="value"
          strokeWidth={0}
        >
          {chartData.map((entry) => (
            <Cell key={entry.status} fill={entry.color} />
          ))}
        </Pie>
        <Tooltip content={<CustomTooltip />} />
      </PieChart>

      {/* Center label */}
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-bold leading-none">{total}</span>
        <span className="mt-1 text-xs text-muted-foreground">ordenes</span>
      </div>
    </div>
  )
}
