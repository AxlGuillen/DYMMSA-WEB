/**
 * MCP App view for odoo_preview_quotation (#144, ADR-040): the quotation as a table, and the only
 * button that creates the missing products (odoo_save_product). Saving the quotation stays with Claude.
 */

import { App, applyDocumentTheme, applyHostFonts, applyHostStyleVariables, type McpUiHostContext } from '@modelcontextprotocol/ext-apps'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { PreviewLine, QuotationPreview } from '@/lib/mcp/tools/odoo/quotations'
import type { ProductsSaveResult } from '@/lib/mcp/tools/odoo/products-write'

// PRODUCTS_AUTHORIZATION_META: importing preview-token would bundle node:crypto (tests/mcp/views.test.ts pins it).
const AUTHORIZATION_META = 'dymmsa/autorizacion'

const state: {
  preview: QuotationPreview | null
  autorizacion: string | null
  error: string | null
  saving: boolean
  saved: ProductsSaveResult | null
  saveError: string | null
} = { preview: null, autorizacion: null, error: null, saving: false, saved: null, saveError: null }

const root = document.getElementById('app') as HTMLElement

/** textContent only: names and notes come from Odoo and the chat, never trusted as markup. */
function el(tag: string, className?: string, text?: string | null): HTMLElement {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text != null) node.textContent = text
  return node
}

function textOf(result: CallToolResult): string {
  const block = result.content?.find((c) => c.type === 'text')
  return block && 'text' in block ? block.text : ''
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

async function createProducts() {
  const preview = state.preview
  if (!preview || !state.autorizacion || state.saving) return
  state.saving = true
  state.saveError = null
  render()
  try {
    const result = await app.callServerTool({
      name: 'odoo_save_product',
      arguments: { productos: preview.productos_para_alta, autorizacion: state.autorizacion },
    })
    if (result.isError) {
      state.saveError = textOf(result) || 'No se pudieron dar de alta'
    } else {
      state.saved = JSON.parse(textOf(result)) as ProductsSaveResult
      const s = state.saved
      const names = [...s.creados, ...s.ya_existian].map((p) => `${p.nombre} (#${p.id})`).join(', ')
      // The model did not make this call: it must rebuild the preview before saving the quotation.
      await app
        .updateModelContext({
          content: [{
            type: 'text',
            text: `El administrador dio de alta en Odoo desde la vista: ${names}. ${s.sin_clave_sat ? `${s.sin_clave_sat} sin clave SAT (capturarla en Odoo antes de timbrar). ` : ''}Pide otra vista previa (odoo_preview_quotation con los mismos datos) para ver los productos recién dados de alta y muestra el resumen antes de guardar.`,
          }],
        })
        .catch(() => undefined)
    }
  } catch {
    state.saveError = 'No se pudieron dar de alta: vuelve a intentarlo.'
  } finally {
    state.saving = false
    render()
  }
}

function renderNewProducts(preview: QuotationPreview): HTMLElement | null {
  if (!preview.productos_nuevos.length) return null
  const box = el('section', 'new-products')
  box.append(el('h2', undefined, `Productos que no existen en Odoo (${preview.productos_nuevos.length})`))
  const list = el('ul')
  for (const p of preview.productos_nuevos) {
    const item = el('li')
    item.append(el('span', 'product', p.nombre_en_odoo), el('span', 'sub', `${money(p.precio, preview.moneda)} · ${p.clave_sat ? `clave SAT ${p.clave_sat}` : 'sin clave SAT'}${p.etm ? ` · ETM ${p.etm}` : ''}`))
    list.append(item)
  }
  box.append(list)

  const footer = el('div', 'footer')
  if (state.saved) {
    const s = state.saved
    footer.append(el('p', 'saved', `Listo: ${s.creados.length} dados de alta${s.ya_existian.length ? `, ${s.ya_existian.length} ya existían` : ''}. Pídele a Claude que vuelva a armar la vista previa.`))
  } else if (state.autorizacion) {
    const button = el('button', 'primary', state.saving ? 'Dando de alta…' : 'Dar de alta en Odoo') as HTMLButtonElement
    button.disabled = state.saving
    button.addEventListener('click', createProducts)
    footer.append(el('p', 'hint', 'Bienes con IVA 16 y factura por entrega; los servicios se dan de alta a mano en Odoo.'), button)
  } else {
    footer.append(el('p', 'hint', 'Corrige los bloqueos para poder darlos de alta, o dalos de alta en Odoo.'))
  }
  if (state.saveError) footer.append(el('p', 'error', state.saveError))
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
  root.append(renderFooter(preview))
}

function applyContext(ctx: McpUiHostContext | undefined) {
  if (!ctx) return
  if (ctx.theme) applyDocumentTheme(ctx.theme)
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables)
  if (ctx.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts)
}

const app = new App({ name: 'DYMMSA · Cotización de Odoo', version: '1.0.0' })

app.ontoolresult = (result) => {
  const text = textOf(result)
  if (result.isError) state.error = text || 'No se pudo armar la vista previa'
  else {
    try {
      state.preview = JSON.parse(text) as QuotationPreview
      // A new result in the same view starts clean: an earlier products save says nothing about it.
      state.saved = null
      state.saveError = null
      const meta = result._meta?.[AUTHORIZATION_META]
      state.autorizacion = typeof meta === 'string' ? meta : null
    } catch {
      state.error = 'La respuesta del servidor llegó incompleta: vuelve a pedir la vista previa'
    }
  }
  render()
}
app.onhostcontextchanged = applyContext

render()
app.connect().then(() => applyContext(app.getHostContext())).catch(() => undefined)
