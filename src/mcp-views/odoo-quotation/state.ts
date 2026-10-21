/** The view's state and what a tool result does to it: pure, so tests/mcp/views.test.ts can drive it. */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { QuotationPreview } from '@/lib/mcp/tools/odoo/quotations'
import type { ProductsSaveResult } from '@/lib/mcp/tools/odoo/products-write'

// PRODUCTS_AUTHORIZATION_META: importing preview-token would bundle node:crypto (tests/mcp/views.test.ts pins it).
export const AUTHORIZATION_META = 'dymmsa/autorizacion'

export interface ViewState {
  preview: QuotationPreview | null
  autorizacion: string | null
  error: string | null
  saving: boolean
  saved: ProductsSaveResult | null
  saveError: string | null
}

export const initialState = (): ViewState => ({ preview: null, autorizacion: null, error: null, saving: false, saved: null, saveError: null })

export function textOf(result: CallToolResult): string {
  const block = result.content?.find((c) => c.type === 'text')
  return block && 'text' in block ? block.text : ''
}

/**
 * A new result starts clean: an earlier products save says nothing about it, and a failed one drops
 * the old preview too, whose badge and button would otherwise hide the error (review PR #152).
 */
export function applyToolResult(state: ViewState, result: CallToolResult): ViewState {
  const fresh: ViewState = { ...state, saved: null, saveError: null, error: null }
  const failed = (message: string): ViewState => ({ ...fresh, preview: null, autorizacion: null, error: message })
  if (result.isError) return failed(textOf(result) || 'No se pudo armar la vista previa')
  try {
    const preview = JSON.parse(textOf(result)) as QuotationPreview
    const meta = result._meta?.[AUTHORIZATION_META]
    return { ...fresh, preview, autorizacion: typeof meta === 'string' ? meta : null }
  } catch {
    return failed('La respuesta del servidor llegó incompleta: vuelve a pedir la vista previa')
  }
}
