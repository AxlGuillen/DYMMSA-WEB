/**
 * MCP App view for preview_time_report (ADR-036): the clock report as a table, and a button that
 * saves it through save_time_entries. Built into one HTML file by scripts/build-mcp-views.ts.
 */

import { App, applyDocumentTheme, applyHostFonts, applyHostStyleVariables, type McpUiHostContext } from '@modelcontextprotocol/ext-apps'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { previewTimeReport, saveTimeEntries } from '@/lib/mcp/tools/hours'

type Preview = Awaited<ReturnType<typeof previewTimeReport>>
type Saved = Extract<Awaited<ReturnType<typeof saveTimeEntries>>, { insertadas: number }>

const state: {
  filas: string[][] | null
  fileName: string | undefined
  preview: Preview | null
  error: string | null
  saving: boolean
  saved: Saved | null
} = { filas: null, fileName: undefined, preview: null, error: null, saving: false, saved: null }

const root = document.getElementById('app') as HTMLElement

/** textContent only: names and notes come from transcribed rows, never trusted as markup. */
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

const shortDate = (iso: string) => {
  const [, m, d] = iso.split('-').map(Number)
  return `${d} ${['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'][m - 1]}`
}

function renderTable(preview: Preview): HTMLElement {
  const wrap = el('div', 'table-wrap')
  const table = el('table')
  const head = el('tr')
  head.append(el('th', 'name', 'Persona'))
  for (const d of preview.dias) {
    const th = el('th', 'day')
    th.append(el('span', 'dow', d.dia), el('span', 'date', shortDate(d.fecha)))
    head.append(th)
  }
  head.append(el('th', 'num', 'Total'), el('th', 'num', 'Reporte'))
  const thead = el('thead')
  thead.append(head)

  const tbody = el('tbody')
  for (const p of preview.personas) {
    const row = el('tr', p.cuadra ? '' : 'row-bad')
    const name = el('td', 'name')
    name.append(el('span', 'person', p.nombre))
    if (!p.perfil) name.append(el('span', 'tag tag-warn', 'sin perfil'))
    row.append(name)
    for (const d of p.por_dia) {
      const cell = el('td', d.sin_salida ? 'day open' : 'day', d.horas ?? '—')
      if (d.checadas.length) cell.title = d.checadas.join(' · ')
      if (d.sin_salida) cell.append(el('span', 'dot', '•'))
      row.append(cell)
    }
    row.append(el('td', 'num strong', p.total), el('td', p.cuadra ? 'num ok' : 'num bad', p.total_reporte ?? '—'))
    tbody.append(row)
  }
  table.append(thead, tbody)
  wrap.append(table)
  return wrap
}

function renderNotes(preview: Preview): HTMLElement | null {
  const notes: [string, string][] = []
  for (const p of preview.problemas) notes.push(['bad', p])
  if (preview.sin_perfil.length) notes.push(['warn', `Sin perfil en la app (no se guardan): ${preview.sin_perfil.join(', ')}`])
  if (preview.no_vinieron_en_el_reporte.length) notes.push(['warn', `No vienen en el reporte: ${preview.no_vinieron_en_el_reporte.join(', ')}`])
  for (const a of preview.avisos) notes.push(['muted', a])
  if (preview.personas.some((p) => p.por_dia.some((d) => d.sin_salida))) notes.push(['muted', '• Checada sin salida: no suma hasta corregirla.'])
  if (preview.personas.some((p) => p.cuadra && p.total !== p.total_reporte)) notes.push(['muted', 'Total y Reporte pueden diferir un minuto: el checador cuenta segundos.'])
  if (!notes.length) return null
  const list = el('ul', 'notes')
  for (const [tone, text] of notes) list.append(el('li', tone, text))
  return list
}

async function save() {
  if (!state.filas || state.saving) return
  state.saving = true
  state.error = null
  render()
  try {
    const result = await app.callServerTool({
      name: 'save_time_entries',
      arguments: { filas: state.filas, ...(state.fileName ? { nombre_archivo: state.fileName } : {}) },
    })
    if (result.isError) {
      state.error = textOf(result) || 'No se pudo guardar'
    } else {
      state.saved = JSON.parse(textOf(result)) as Saved
      const s = state.saved
      // The model did not make this call: tell it, so it does not offer to save again.
      await app
        .updateModelContext({
          content: [{ type: 'text', text: `El administrador guardó el reporte del checador desde la vista: ${s.insertadas} nuevas, ${s.actualizadas} actualizadas, ${s.saltadas_por_edicion} saltadas por corrección.` }],
        })
        .catch(() => undefined)
    }
  } catch {
    state.error = 'No se pudo guardar: vuelve a intentarlo o pídeselo a Claude.'
  } finally {
    state.saving = false
    render()
  }
}

function renderFooter(preview: Preview): HTMLElement {
  const footer = el('div', 'footer')
  if (state.saved) {
    const s = state.saved
    footer.append(el('p', 'saved', `Guardado en Horas: ${s.insertadas} nuevas, ${s.actualizadas} actualizadas${s.saltadas_por_edicion ? `, ${s.saltadas_por_edicion} sin tocar porque un administrador las corrigió` : ''}.`))
    return footer
  }
  const mapped = preview.personas.some((p) => p.perfil)
  const button = el('button', 'primary', state.saving ? 'Guardando…' : 'Guardar en Horas') as HTMLButtonElement
  button.disabled = state.saving || !preview.cuadra || !mapped || !state.filas
  button.addEventListener('click', save)
  const hint = !preview.cuadra
    ? 'No cuadra con los totales del reporte: corrige las filas antes de guardar.'
    : !state.filas
      ? 'Pídele a Claude que lo guarde.'
      : 'Re-subir la misma semana no duplica ni pisa correcciones.'
  footer.append(el('p', 'hint', hint), button)
  if (state.error) footer.append(el('p', 'error', state.error))
  return footer
}

function render() {
  root.replaceChildren()
  const preview = state.preview
  if (!preview) {
    root.append(el('p', state.error ? 'error' : 'muted', state.error ?? 'Leyendo el reporte…'))
    return
  }
  const header = el('div', 'header')
  const title = el('div')
  title.append(
    el('h1', undefined, 'Reporte del checador'),
    el('p', 'muted', `${shortDate(preview.periodo.inicio)} – ${shortDate(preview.periodo.fin)} ${preview.periodo.fin.slice(0, 4)}${preview.nombre_archivo ? ` · ${preview.nombre_archivo}` : ''}`),
  )
  header.append(title, el('span', preview.cuadra ? 'badge ok' : 'badge bad', preview.cuadra ? 'Cuadra con el reporte' : 'No cuadra'))
  root.append(header, renderTable(preview))
  const notes = renderNotes(preview)
  if (notes) root.append(notes)
  root.append(renderFooter(preview))
}

function applyContext(ctx: McpUiHostContext | undefined) {
  if (!ctx) return
  if (ctx.theme) applyDocumentTheme(ctx.theme)
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables)
  if (ctx.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts)
}

const app = new App({ name: 'DYMMSA · Reporte del checador', version: '1.0.0' })

app.ontoolinput = ({ arguments: args }) => {
  const filas = args?.filas
  if (Array.isArray(filas)) state.filas = filas as string[][]
  if (typeof args?.nombre_archivo === 'string') state.fileName = args.nombre_archivo
  render()
}
app.ontoolresult = (result) => {
  const text = textOf(result)
  if (result.isError) state.error = text || 'No se pudo leer el reporte'
  else {
    // A truncated payload must not leave the view stuck on "Leyendo el reporte…" (review PR #138).
    try {
      state.preview = JSON.parse(text) as Preview
    } catch {
      state.error = 'La respuesta del servidor llegó incompleta: vuelve a pedir la vista previa'
    }
  }
  render()
}
app.onhostcontextchanged = applyContext

render()
app.connect().then(() => applyContext(app.getHostContext())).catch(() => undefined)
