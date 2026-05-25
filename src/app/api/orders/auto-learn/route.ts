import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/api-helpers'
import type { ApprovedProduct, AutoLearnResult } from '@/types/database'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error
    const { user } = auth

    const { products } = (await request.json()) as { products: ApprovedProduct[] }

    if (!products || !Array.isArray(products)) {
      return NextResponse.json({ message: 'Productos requeridos' }, { status: 400 })
    }

    const result: AutoLearnResult = {
      added: 0,
      skipped: 0,
      existing: 0,
    }

    for (const product of products) {
      // Validate required fields for auto-learn (all except quantity)
      if (
        !product.etm ||
        !product.description ||
        !product.model_code ||
        product.price === undefined
      ) {
        result.skipped++
        continue
      }

      // Check if ETM already exists
      // oxlint-disable-next-line react-doctor/async-await-in-loop -- sequential DB writes (ordering / avoid inventory races)
      const { data: existing } = await supabase
        .from('etm_products')
        .select('id')
        .eq('etm', product.etm)
        .single()

      if (existing) {
        result.existing++
        continue
      }

      // Insert new product
      const { error } = await supabase.from('etm_products').insert({
        etm: product.etm,
        description: product.description,
        description_es: product.description_es || '',
        model_code: product.model_code,
        price: product.price,
        brand: 'URREA', // Default brand
        created_by: user.id,
      })

      if (error) {
        console.error('Error inserting product:', error)
        result.skipped++
      } else {
        result.added++
      }
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error('Auto-learn error:', error)
    return NextResponse.json(
      { message: 'Error en auto-aprendizaje' },
      { status: 500 }
    )
  }
}
