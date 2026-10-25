/**
 * MCP App view for odoo_preview_quotation (#144, #154, ADR-040): the quotation as a table, and the only
 * buttons that create the missing products or key the existing ones (odoo_save_product). Saving stays with Claude.
 */

import { App, applyDocumentTheme, applyHostFonts, applyHostStyleVariables, type McpUiHostContext } from '@modelcontextprotocol/ext-apps'
import type { PreviewLine, QuotationPreview } from '@/lib/mcp/tools/odoo/quotations'
import type { ProductsSaveResult, SatAssignResult } from '@/lib/mcp/tools/odoo/products-write'
import {
  altaArguments,
  applyToolResult,
  assignArguments,
  assignChoiceKey,
  assignedSummary,
  dataOf,
  defaultSatChoice,
  initialState,
  newChoiceKey,
  OTHER_SAT,
  satOptions,
  textOf,
  type ButtonArgs,
  type SatItem,
} from './state'

let state = initialState()

/** The two buttons and their error lines: typing a key updates them without re-rendering the input. */
const controls: { alta?: [HTMLButtonElement, HTMLElement]; assign?: [HTMLButtonElement, HTMLElement] } = {}

const root = document.getElementById('app') as HTMLElement

/** textContent only: names and notes come from Odoo and the chat, never trusted as markup. */
function el(tag: string, className?: string, text?: string | null): HTMLElement {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text != null) node.textContent = text
  return node
}


function money(value: number | null | undefined, currency: string): string {
  if (value == null) return '—'
  try {
    return new Intl.NumberFormat('es-MX', { style: 'currency', currency }).format(value)
  } catch {
    return value.toFixed(2)
  }
}

const qty = (value: number | null | undefined) => (value == null ? '—' : new Intl.NumberFormat('es-MX', { maximumFractionDigits: 3 }).format(value))

const MODE_TITLE: Record<QuotationPreview['modo'], string> = {
  crear: 'Nueva cotización',
  editar: 'Editar cotización',
  revisar: 'Revisión para confirmar',
}

const STATE_TAG: Record<string, [string, string]> = {
  existe: ['', ''],
  nuevo: ['tag-warn', 'nuevo'],
  ambiguo: ['tag-bad', 'varias coincidencias'],
  bloqueado: ['tag-bad', 'bloqueado'],
}

const ACTION_TAG: Record<string, [string, string]> = {
  nueva: ['tag-ok', 'nueva'],
  cambia: ['tag-warn', 'cambia'],
  se_quita: ['tag-bad', 'se quita'],
}

function productCell(line: PreviewLine): HTMLElement {
  const cell = el('td', 'name')
  const name = line.producto?.nombre ?? line.propuesto?.nombre ?? line.pedido ?? ''
  cell.append(el('span', 'product', name))
  const [stateClass, stateText] = STATE_TAG[line.estado ?? 'existe'] ?? ['', '']
  if (stateText) cell.append(el('span', `tag ${stateClass}`, stateText))
  const [actionClass, actionText] = ACTION_TAG[line.accion ?? ''] ?? ['', '']
  if (actionText) cell.append(el('span', `tag ${actionClass}`, actionText))
  if (line.pedido && line.pedido !== name) cell.append(el('span', 'sub', `Pedido: ${line.pedido}`))
  if (line.motivo) cell.append(el('span', 'sub bad', line.motivo))
  if (line.candidatos?.length) cell.append(el('span', 'sub', `Opciones: ${line.candidatos.map((c) => `${c.nombre} (#${c.id})`).join(' · ')}`))
  if (line.producto && !line.producto.clave_sat) cell.append(el('span', 'sub warn', 'Sin clave SAT en Odoo'))
  return cell
}

function beforeText(line: PreviewLine, currency: string): string | null {
  const b = line.antes
  if (!b) return null
  const parts: string[] = []
  if (b.cantidad !== undefined) parts.push(`cant. ${qty(b.cantidad)}`)
  if (b.precio !== undefined) parts.push(money(b.precio, currency))
  if (b.descuento !== undefined) parts.push(`${b.descuento}%`)
  if (b.texto !== undefined) parts.push(`«${b.texto}»`)
  return parts.length ? `Antes: ${parts.join(' · ')}` : null
}

function renderTable(preview: QuotationPreview): HTMLElement {
  const wrap = el('div', 'table-wrap')
  const table = el('table')
  const head = el('tr')
  head.append(el('th', 'num', '#'), el('th', 'name', 'Producto'), el('th', 'num', 'Cant.'), el('th', 'num', 'Precio'), el('th', 'num', 'Desc.'), el('th', 'num', 'Subtotal'))
  const thead = el('thead')
  thead.append(head)

  const tbody = el('tbody')
  for (const line of preview.lineas) {
    const removed = line.accion === 'se_quita'
    if (line.tipo !== 'producto') {
      const row = el('tr', `${line.tipo === 'seccion' ? 'section' : 'note'}${removed ? ' removed' : ''}`)
      const text = el('td', 'name', line.texto ?? '')
      text.setAttribute('colspan', '5')
      const [actionClass, actionText] = ACTION_TAG[line.accion ?? ''] ?? ['', '']
      if (actionText) text.append(el('span', `tag ${actionClass}`, actionText))
      row.append(el('td', 'num muted', line.n == null ? '' : String(line.n)), text)
      tbody.append(row)
      continue
    }
    const row = el('tr', `${removed ? 'removed' : ''}${line.estado && line.estado !== 'existe' ? ' row-attention' : ''}`)
    const product = productCell(line)
    const before = beforeText(line, preview.moneda)
    if (before) product.append(el('span', 'sub', before))
    row.append(
      el('td', 'num muted', line.n == null ? '' : String(line.n)),
      product,
      el('td', 'num', qty(line.cantidad)),
      el('td', 'num', money(line.precio, preview.moneda)),
      el('td', 'num', line.descuento ? `${line.descuento}%` : '—'),
      el('td', 'num strong', money(line.subtotal, preview.moneda)),
    )
    tbody.append(row)
  }
  const total = el('tr', 'total')
  const label = el('td', 'num', 'Subtotal sin IVA')
  label.setAttribute('colspan', '5')
  total.append(label, el('td', 'num strong', money(preview.subtotal, preview.moneda)))
  tbody.append(total)
  table.append(thead, tbody)
  wrap.append(table)
  return wrap
}

function renderNotes(preview: QuotationPreview): HTMLElement {
  const notes: [string, string][] = []
  for (const b of preview.bloqueos) notes.push(['bad', b])
  for (const a of preview.avisos) notes.push(['warn', a])
  if (preview.al_confirmar) notes.push(['muted', `Al confirmar: ${preview.al_confirmar}`])
  notes.push(['muted', preview.impuestos])
  const list = el('ul', 'notes')
  for (const [tone, text] of notes) list.append(el('li', tone, text))
  return list
}

/** The model did not make these calls: it must rebuild the preview before saving or confirming. */
function tellModel(text: string) {
  return app
    .updateModelContext({
      content: [{ type: 'text', text: `${text} Pide otra vista previa (odoo_preview_quotation con los mismos datos) para verlo y muestra el resumen antes de guardar o confirmar.` }],
    })
    .catch(() => undefined)
}

async function createProducts() {
  const ready = altaArguments(state)
  if (!ready.ready || state.saving) return
  state.saving = true
  state.saveError = null
  render()
  try {
    const result = await app.callServerTool({ name: 'odoo_save_product', arguments: { ...ready.args } })
    if (result.isError) {
      state.saveError = textOf(result) || 'No se pudieron dar de alta'
    } else {
      state.saved = dataOf<ProductsSaveResult>(result)
      const s = state.saved
      const names = [...s.creados, ...s.ya_existian].map((p) => `${p.nombre} (#${p.id})`).join(', ')
      await tellModel(
        `El administrador dio de alta en Odoo desde la vista: ${names}.${s.sin_clave_sat ? ` ${s.sin_clave_sat} sin clave SAT (capturarla antes de timbrar).` : ''}`,
      )
    }
  } catch {
    state.saveError = 'No se pudieron dar de alta: vuelve a intentarlo.'
  } finally {
    state.saving = false
    render()
  }
}

async function assignKeys() {
  const ready = assignArguments(state)
  if (!ready.ready || state.assigning) return
  state.assigning = true
  state.assignError = null
  render()
  try {
    const result = await app.callServerTool({ name: 'odoo_save_product', arguments: { ...ready.args } })
    if (result.isError) {
      state.assignError = textOf(result) || 'No se pudo asignar la clave SAT'
    } else {
      state.assigned = dataOf<SatAssignResult>(result)
      await tellModel(assignedSummary(state.assigned))
    }
  } catch {
    state.assignError = 'No se pudo asignar la clave SAT: vuelve a intentarlo.'
  } finally {
    state.assigning = false
    render()
  }
}

/** Buttons follow the choices: a half-typed key turns its button off and says why. */
function syncButton(pair: [HTMLButtonElement, HTMLElement] | undefined, ready: ButtonArgs<unknown>, busy: boolean, failure: string | null) {
  if (!pair) return
  const [button, error] = pair
  button.disabled = busy || !ready.ready
  error.textContent = (!ready.ready && ready.reason) || failure || ''
}

function syncButtons() {
  syncButton(controls.alta, altaArguments(state), state.saving, state.saveError)
  syncButton(controls.assign, assignArguments(state), state.assigning, state.assignError)
}

const domId = (prefix: string, key: string) => `${prefix}-${key.replace(/[^a-z0-9]/gi, '-')}`
const typedInputId = (key: string) => domId('sat-input', key)
const selectId = (key: string) => domId('sat-select', key)

function satPicker(key: string, item: SatItem, disabled: boolean): HTMLElement {
  const wrap = el('div', 'sat')
  const choice = state.choices[key] ?? defaultSatChoice(item)
  const select = document.createElement('select')
  select.id = selectId(key)
  select.setAttribute('aria-label', 'Clave SAT')
  for (const option of satOptions(item)) {
    const node = document.createElement('option')
    node.value = option.value
    node.textContent = option.label
    select.append(node)
  }
  select.value = choice.value
  select.disabled = disabled
  select.addEventListener('change', () => {
    const before = state.choices[key] ?? defaultSatChoice(item)
    state.choices = { ...state.choices, [key]: { value: select.value, typed: before.typed } }
    // Only the "Otra clave" input changes the tree: any other choice keeps the keyboard focus (review PR #167).
    if ((before.value === OTHER_SAT) === (select.value === OTHER_SAT)) return syncButtons()
    render()
    document.getElementById(select.value === OTHER_SAT ? typedInputId(key) : selectId(key))?.focus()
  })
  wrap.append(el('span', 'sat-label', 'Clave SAT'), select)
  if (choice.value === OTHER_SAT) {
    const input = document.createElement('input')
    input.id = typedInputId(key)
    input.inputMode = 'numeric'
    input.maxLength = 8
    input.placeholder = '8 dígitos'
    input.value = choice.typed
    input.disabled = disabled
    input.addEventListener('input', () => {
      state.choices = { ...state.choices, [key]: { value: OTHER_SAT, typed: input.value } }
      syncButtons()
    })
    wrap.append(input)
  }
  return wrap
}

function renderNewProducts(preview: QuotationPreview): HTMLElement | null {
  if (!preview.productos_nuevos.length) return null
  const box = el('section', 'new-products')
  box.append(el('h2', undefined, `Productos que no existen en Odoo (${preview.productos_nuevos.length})`))
  const picking = Boolean(state.autorizacion) && !state.saved
  const list = el('ul')
  for (const [i, p] of preview.productos_nuevos.entries()) {
    const item = el('li')
    const sat = picking ? '' : ` · ${p.clave_sat ? `clave SAT ${p.clave_sat}` : 'sin clave SAT'}`
    item.append(el('span', 'product', p.nombre_en_odoo), el('span', 'sub', `${money(p.precio, preview.moneda)}${sat}${p.etm ? ` · ETM ${p.etm}` : ''}`))
    if (picking) item.append(satPicker(newChoiceKey(i), p, state.saving))
    list.append(item)
  }
  box.append(list)

  const footer = el('div', 'footer')
  if (state.saved) {
    const s = state.saved
    footer.append(el('p', 'saved', `Listo: ${s.creados.length} dados de alta${s.ya_existian.length ? `, ${s.ya_existian.length} ya existían` : ''}. Pídele a Claude que vuelva a armar la vista previa.`))
  } else if (state.autorizacion) {
    const button = el('button', 'primary', state.saving ? 'Dando de alta…' : 'Dar de alta en Odoo') as HTMLButtonElement
    button.addEventListener('click', createProducts)
    const error = el('p', 'error')
    footer.append(el('p', 'hint', 'Bienes con IVA 16 y factura por entrega; los servicios se dan de alta a mano en Odoo.'), button, error)
    controls.alta = [button, error]
  } else {
    footer.append(el('p', 'hint', 'Corrige los bloqueos para poder darlos de alta, o dalos de alta en Odoo.'))
  }
  box.append(footer)
  return box
}

function renderWithoutSat(preview: QuotationPreview): HTMLElement | null {
  const items = preview.sin_clave_sat ?? []
  if (!items.length || !state.autorizacion) return null
  const box = el('section', 'new-products')
  box.append(el('h2', undefined, `Productos de Odoo sin clave SAT (${items.length})`))
  const list = el('ul')
  for (const p of items) {
    const item = el('li')
    const lines = `${p.lineas.length === 1 ? 'Línea' : 'Líneas'} ${p.lineas.join(', ')}`
    item.append(el('span', 'product', p.nombre), el('span', 'sub', `${lines} · #${p.producto_id}`))
    if (!state.assigned) item.append(satPicker(assignChoiceKey(p.producto_id), p, state.assigning))
    list.append(item)
  }
  box.append(list)

  const footer = el('div', 'footer')
  if (state.assigned) {
    const s = state.assigned
    footer.append(el('p', 'saved', `Listo: ${s.asignados.length} con clave SAT${s.ya_tenian.length ? `, ${s.ya_tenian.length} ya la tenían` : ''}. Pídele a Claude que vuelva a armar la vista previa.`))
  } else {
    const button = el('button', 'primary', state.assigning ? 'Asignando…' : 'Asignar clave SAT') as HTMLButtonElement
    button.addEventListener('click', assignKeys)
    const error = el('p', 'error')
    footer.append(el('p', 'hint', 'Sin clave no se puede timbrar. Solo se llena la que falta: una que ya esté en Odoo no se toca.'), button, error)
    controls.assign = [button, error]
  }
  box.append(footer)
  return box
}

function renderFooter(preview: QuotationPreview): HTMLElement {
  const footer = el('div', 'footer')
  if (!preview.puede_guardar) {
    footer.append(el('p', 'hint', 'Nada se ha guardado. Corrige los bloqueos y pide otra vista previa.'))
    return footer
  }
  const pending = preview.productos_para_alta.length > 0 && !state.saved
  const until = preview.vence ? new Date(preview.vence) : null
  const time = until && !Number.isNaN(until.getTime()) ? until.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }) : null
  const next = pending
    ? 'Primero da de alta los productos nuevos.'
    : preview.modo === 'revisar'
      ? 'Para confirmarla como venta, dile a Claude «sí, confírmala».'
      : 'Si está bien, dile a Claude «sí, guárdala»: quedará en borrador.'
  // es-MX writes "p.m.": no second period after it.
  footer.append(el('p', 'hint', `Nada se ha guardado. ${next}${time ? ` La vista previa vale hasta las ${time}${time.endsWith('.') ? '' : '.'}` : ''}`))
  return footer
}

function render() {
  root.replaceChildren()
  controls.alta = undefined
  controls.assign = undefined
  const preview = state.preview
  if (!preview) {
    root.append(el('p', state.error ? 'error' : 'muted', state.error ?? 'Armando la vista previa…'))
    return
  }
  const header = el('div', 'header')
  const title = el('div')
  const folio = preview.cotizacion ? ` ${preview.cotizacion.folio}` : ''
  const client = `${preview.cliente.nombre}${preview.cliente.rfc ? ` · ${preview.cliente.rfc}` : ''}`
  title.append(el('h1', undefined, `${MODE_TITLE[preview.modo]}${folio}`), el('p', 'muted', client))
  const pending = preview.productos_para_alta.length > 0 && !state.saved
  const [badgeClass, badgeText] = !preview.puede_guardar
    ? ['badge bad', 'Con bloqueos']
    : pending
      ? ['badge warn', 'Faltan productos']
      : ['badge ok', preview.modo === 'revisar' ? 'Lista para confirmar' : 'Lista para guardar']
  header.append(title, el('span', badgeClass, badgeText))
  root.append(header, renderTable(preview))
  root.append(renderNotes(preview))
  const fresh = renderNewProducts(preview)
  if (fresh) root.append(fresh)
  const unkeyed = renderWithoutSat(preview)
  if (unkeyed) root.append(unkeyed)
  root.append(renderFooter(preview))
  syncButtons()
}

function applyContext(ctx: McpUiHostContext | undefined) {
  if (!ctx) return
  if (ctx.theme) applyDocumentTheme(ctx.theme)
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables)
  if (ctx.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts)
}

const app = new App({ name: 'DYMMSA · Cotización de Odoo', version: '1.0.0' })

app.ontoolresult = (result) => {
  state = applyToolResult(state, result)
  render()
}
app.onhostcontextchanged = applyContext

render()
app.connect().then(() => applyContext(app.getHostContext())).catch(() => undefined)
