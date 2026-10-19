import { Suspense } from 'react'
import type { Metadata } from 'next'
import { CustomersList } from '@/components/customers/CustomersList'
import { TourButton } from '@/components/tours/TourButton'

export const metadata: Metadata = {
  title: 'Clientes | DYMMSA',
}

export default function CustomersPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Clientes</h1>
          <p className="text-muted-foreground">
            Lo que cada cliente debe según Odoo, vencido y por vencer — y su estado de cuenta para mandárselo.
          </p>
        </div>
        <TourButton tour="customers" />
      </div>
      {/* The range lives in the URL (useSearchParams), which needs a Suspense boundary. */}
      <Suspense>
        <CustomersList />
      </Suspense>
    </div>
  )
}
