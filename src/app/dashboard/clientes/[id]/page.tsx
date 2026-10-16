import { Suspense } from 'react'
import type { Metadata } from 'next'
import { CustomerDetail } from '@/components/customers/CustomerDetail'

export const metadata: Metadata = {
  title: 'Cliente | DYMMSA',
}

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <Suspense>
      <CustomerDetail id={id} />
    </Suspense>
  )
}
