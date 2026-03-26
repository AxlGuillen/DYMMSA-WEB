import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ message: 'No autorizado' }, { status: 401 })

  const { data } = await supabase
    .from('etm_products')
    .select('etm')
    .like('etm', 'DYMMSA-%')

  const maxNum = (data ?? []).reduce((max, row: { etm: string }) => {
    const match = row.etm.match(/^DYMMSA-(\d+)$/)
    if (!match) return max
    return Math.max(max, parseInt(match[1], 10))
  }, 0)

  return NextResponse.json({ next: maxNum + 1 })
}
