'use client'

import { Badge } from '@/components/ui/badge'
import type { QuotationStatus } from '@/types/database'

const statusConfig: Record<
  QuotationStatus,
  { label: string; className: string }
> = {
  draft: {
    label: 'Borrador',
    className:
      'bg-gray-100 text-gray-700 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-800',
  },
  sent_for_approval: {
    label: 'En aprobación',
    className:
      'bg-blue-100 text-blue-800 hover:bg-blue-100 dark:bg-blue-900/50 dark:text-blue-300 dark:hover:bg-blue-900/50',
  },
  approved: {
    label: 'Aprobada',
    className:
      'bg-green-100 text-green-800 hover:bg-green-100 dark:bg-green-900/50 dark:text-green-300 dark:hover:bg-green-900/50',
  },
  rejected: {
    label: 'Rechazada',
    className:
      'bg-red-100 text-red-800 hover:bg-red-100 dark:bg-red-900/50 dark:text-red-300 dark:hover:bg-red-900/50',
  },
  converted_to_order: {
    label: 'Convertida',
    className:
      'bg-purple-100 text-purple-800 hover:bg-purple-100 dark:bg-purple-900/50 dark:text-purple-300 dark:hover:bg-purple-900/50',
  },
}

interface QuotationStatusBadgeProps {
  status: QuotationStatus
}

export function QuotationStatusBadge({ status }: QuotationStatusBadgeProps) {
  const config = statusConfig[status]
  return (
    <Badge variant="outline" className={config.className}>
      {config.label}
    </Badge>
  )
}
