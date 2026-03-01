import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { ApprovalClient } from './ApprovalClient'
import type { QuotationWithItems } from '@/types/database'

export default async function ApprovalPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('quotations')
    .select('*, quotation_items(*)')
    .eq('approval_token', token)
    .single()

  if (error || !data) {
    notFound()
  }

  return <ApprovalClient quotation={data as QuotationWithItems} token={token} />
}
