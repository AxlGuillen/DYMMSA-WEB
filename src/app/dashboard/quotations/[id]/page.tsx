'use client'

import { use } from 'react'
import { notFound } from 'next/navigation'
import { Skeleton } from '@/components/ui/skeleton'
import { QuotationDetail } from '@/components/quotations/QuotationDetail'
import { useQuotation } from '@/hooks/useQuotations'

export default function QuotationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const { data: quotation, isLoading, error } = useQuotation(id)

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-9 w-9 rounded-md" />
          <div className="space-y-2">
            <Skeleton className="h-7 w-64" />
            <Skeleton className="h-4 w-40" />
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-96 rounded-lg" />
      </div>
    )
  }

  if (error || !quotation) {
    notFound()
  }

  return <QuotationDetail quotation={quotation} />
}
