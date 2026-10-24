/** The view's state and what a tool result does to it: pure, so tests/mcp/views.test.ts can drive it. */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { ProductWithoutSat, QuotationPreview } from '@/lib/mcp/tools/odoo/quotations'
import type { ProductsSaveResult, SatAssignResult } from '@/lib/mcp/tools/odoo/products-write'

// PRODUCTS_AUTHORIZATION_META: importing preview-token would bundle node:crypto (tests/mcp/views.test.ts pins it).
export const AUTHORIZATION_META = 'dymmsa/autorizacion'

// SAT_PLACEHOLDER (src/lib/odoo/sat-keys.ts), copied for the same reason and pinned by the same test.
export const SAT_PLACEHOLDER = '01010101'

/** The picker's value for a key the admin types instead of choosing (#154). */
export const OTHER_SAT = 'otra'

/** '' = sin clave, an offered key, or OTHER_SAT with what was typed. */
export interface SatChoice {
  readonly value: string
  readonly typed: string
}

export interface ViewState {
  preview: QuotationPreview | null
  autorizacion: string | null
  error: string | null
  saving: boolean
  saved: ProductsSaveResult | null
  saveError: string | null
  /** By newChoiceKey / assignChoiceKey; a missing one is defaultSatChoice(). */
  choices: Readonly<Record<string, SatChoice>>
  assigning: boolean
  assigned: SatAssignResult | null
  assignError: string | null
}

export const initialState = (): ViewState => ({
  preview: null,
  autorizacion: null,
  error: null,
  saving: false,
  saved: null,
  saveError: null,
  choices: {},
  assigning: false,
  assigned: null,
  assignError: null,
})

export function textOf(result: CallToolResult): string {
  const block = result.content?.find((c) => c.type === 'text')
  return block && 'text' in block ? block.text : ''
}

/**
 * A new result starts clean: an earlier save or choice says nothing about it, and a failed one drops
 * the old preview too, whose badge and button would otherwise hide the error (review PR #152).
 */
export function applyToolResult(state: ViewState, result: CallToolResult): ViewState {
  const fresh: ViewState = { ...state, saved: null, saveError: null, error: null, choices: {}, assigned: null, assignError: null }
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

/** A new product or an existing one without a key: both carry the same SAT fields. */
export type SatItem = Pick<ProductWithoutSat, 'clave_sat' | 'clave_sat_propuesta' | 'sugerencias_sat'>

export const newChoiceKey = (index: number) => `alta:${index}`
export const assignChoiceKey = (productId: number) => `asignar:${productId}`

export interface SatOption {
  readonly value: string
  readonly label: string
}

/** The chat's key, the suggestions, and the two ways out: no key, or typing another one. */
export function satOptions(item: SatItem): SatOption[] {
  const options: SatOption[] = [{ value: '', label: 'Sin clave SAT (se captura después en Odoo)' }]
  if (item.clave_sat) options.push({ value: item.clave_sat, label: `${item.clave_sat} · la de la cotización` })
  for (const s of item.sugerencias_sat) {
    if (s.clave !== item.clave_sat) options.push({ value: s.clave, label: `${s.clave} · ${s.nombre}` })
  }
  options.push({ value: OTHER_SAT, label: 'Otra clave (teclearla)…' })
  return options
}

/** Preselected: the chat's key, or the one categoria_sat found alone; a mere suggestion waits for the admin. */
export function defaultSatChoice(item: SatItem): SatChoice {
  return { value: item.clave_sat ?? item.clave_sat_propuesta ?? '', typed: '' }
}

export interface ChosenKey {
  readonly clave_sat?: string
  /** The server accepts a key it didn't offer only with this mark, and still looks it up in the catalog. */
  readonly clave_sat_tecleada?: true
}

export type KeyChoiceResult = { readonly ok: true; readonly key: ChosenKey } | { readonly ok: false; readonly error: string }

export function chosenKey(choice: SatChoice): KeyChoiceResult {
  if (choice.value === '') return { ok: true, key: {} }
  if (choice.value !== OTHER_SAT) return { ok: true, key: { clave_sat: choice.value } }
  const typed = choice.typed.trim()
  if (!/^\d{8}$/.test(typed)) return { ok: false, error: 'la clave SAT lleva 8 dígitos.' }
  if (typed === SAT_PLACEHOLDER) {
    return { ok: false, error: `${SAT_PLACEHOLDER} significa «no existe en el catálogo»: usa la clave real o déjalo sin clave.` }
  }
  return { ok: true, key: { clave_sat: typed, clave_sat_tecleada: true } }
}

/** A button's arguments, or why it stays off (reason null: nothing to say yet). */
export type ButtonArgs<T> = { readonly ready: true; readonly args: T } | { readonly ready: false; readonly reason: string | null }

const NO_KEY: SatItem = { clave_sat: null, clave_sat_propuesta: null, sugerencias_sat: [] }

const choiceFor = (state: ViewState, key: string, item: SatItem) => state.choices[key] ?? defaultSatChoice(item)

export interface AltaArguments {
  readonly productos: readonly Record<string, unknown>[]
  readonly autorizacion: string
}

/** odoo_save_product's alta: productos_para_alta as signed, each with the key chosen for it. */
export function altaArguments(state: ViewState): ButtonArgs<AltaArguments> {
  const preview = state.preview
  if (!preview || !state.autorizacion || preview.productos_para_alta.length === 0) return { ready: false, reason: null }
  const productos: Record<string, unknown>[] = []
  for (const [i, product] of preview.productos_para_alta.entries()) {
    const item = preview.productos_nuevos?.[i] ?? NO_KEY
    const result = chosenKey(choiceFor(state, newChoiceKey(i), item))
    if (!result.ok) return { ready: false, reason: `${preview.productos_nuevos?.[i]?.nombre_en_odoo ?? product.codigo}: ${result.error}` }
    const { clave_sat: _signed, ...base } = product
    productos.push({ ...base, ...result.key })
  }
  return { ready: true, args: { productos, autorizacion: state.autorizacion } }
}

export interface AssignArguments {
  readonly asignar: readonly ({ readonly producto_id: number } & ChosenKey)[]
  readonly autorizacion: string
}

/** odoo_save_product's assign mode: only the products given a key; "sin clave" ones are left alone. */
export function assignArguments(state: ViewState): ButtonArgs<AssignArguments> {
  const preview = state.preview
  const items = preview?.sin_clave_sat ?? []
  if (!state.autorizacion || items.length === 0) return { ready: false, reason: null }
  const asignar: ({ producto_id: number } & ChosenKey)[] = []
  for (const item of items) {
    const result = chosenKey(choiceFor(state, assignChoiceKey(item.producto_id), item))
    if (!result.ok) return { ready: false, reason: `${item.nombre}: ${result.error}` }
    if (result.key.clave_sat) asignar.push({ producto_id: item.producto_id, ...result.key })
  }
  if (asignar.length === 0) return { ready: false, reason: null }
  return { ready: true, args: { asignar, autorizacion: state.autorizacion } }
}
