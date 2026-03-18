'use client'

import type { ReactNode } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

export type MetricColor = 'blue' | 'green' | 'orange' | 'purple'

const colorMap: Record<MetricColor, string> = {
  blue:   'bg-blue-100 text-blue-600 dark:bg-blue-950 dark:text-blue-400',
  green:  'bg-green-100 text-green-600 dark:bg-green-950 dark:text-green-400',
  orange: 'bg-orange-100 text-orange-600 dark:bg-orange-950 dark:text-orange-400',
  purple: 'bg-purple-100 text-purple-600 dark:bg-purple-950 dark:text-purple-400',
}

interface MetricCardProps {
  title: string
  value: string | number
  description?: string
  icon?: ReactNode
  color?: MetricColor
  isLoading?: boolean
}

export function MetricCard({
  title,
  value,
  description,
  icon,
  color,
  isLoading,
}: MetricCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        {icon && (
          <div className={cn(
            'rounded-lg p-2',
            color ? colorMap[color] : 'bg-muted text-muted-foreground'
          )}>
            {icon}
          </div>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-24" />
            {description !== undefined && <Skeleton className="h-4 w-32" />}
          </div>
        ) : (
          <>
            <div className="text-2xl font-bold">{value}</div>
            {description && (
              <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
