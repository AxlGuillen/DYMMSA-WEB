/** MCP App view of the clock report (ADR-036): renders the preview and saves through the host. */

import { describe, test, expect, vi, beforeEach } from 'vitest'
import { createMockSupabase } from '../helpers/supabase-mock'
import { NGTECO_WEEK } from '../helpers/fixtures/ngteco'
import { previewTimeReport } from '@/lib/mcp/tools/hours'
import type { Db } from '@/lib/mcp/shared'

type Handler = (params: unknown) => void
const host = vi.hoisted(() => ({
  app: null as null | {
    ontoolinput: Handler
    ontoolresult: Handler
    callServerTool: ReturnType<typeof vi.fn>
    updateModelContext: ReturnType<typeof vi.fn>
  },
}))

vi.mock('@modelcontextprotocol/ext-apps', () => ({
  App: class {
    ontoolinput: Handler = () => {}
    ontoolresult: Handler = () => {}
    onhostcontextchanged: Handler = () => {}
    callServerTool = vi.fn()
    updateModelContext = vi.fn().mockResolvedValue({})
    constructor() {
      host.app = this
    }
    connect = () => Promise.resolve()
    getHostContext = () => undefined
  },
  applyDocumentTheme: vi.fn(),
  applyHostFonts: vi.fn(),
  applyHostStyleVariables: vi.fn(),
}))

const asText = (data: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(data) }] })

async function mount(filas = NGTECO_WEEK) {
  document.body.innerHTML = '<main id="app"></main>'
  vi.resetModules()
  await import('@/mcp-views/time-report/main')
  const db = createMockSupabase({ responses: { 'profiles.select': { data: [{ id: 'u-tania', display_name: 'Tania', clock_employee_id: 5 }, { id: 'u-diego', display_name: 'Diego', clock_employee_id: 1 }], error: null } } })
  const preview = await previewTimeReport(db as unknown as Db, { filas })
  host.app!.ontoolinput({ arguments: { filas, nombre_archivo: 'semana.xls' } })
  host.app!.ontoolresult(asText(preview))
  return document.getElementById('app') as HTMLElement
}

const saveButton = (root: HTMLElement) => [...root.querySelectorAll('button')].find((b) => b.textContent === 'Guardar en Horas') as HTMLButtonElement

describe('vista del reporte del checador', () => {
  beforeEach(() => {
    host.app = null
  })

  test('pinta la tabla por persona y día con la insignia de que cuadra', async () => {
    const root = await mount()
    expect(root.querySelector('h1')?.textContent).toBe('Reporte del checador')
    expect(root.querySelector('.badge')?.textContent).toBe('Cuadra con el reporte')
    const rows = [...root.querySelectorAll('tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent))
    expect(rows[0][0]).toBe('Diego Baltazar')
    expect(rows[0].slice(1, 3)).toEqual(['08:21', '10:25'])
    expect(rows[0].slice(-2)).toEqual(['18:46', '18:46'])
    expect(root.querySelector('td.open')?.textContent).toBe('00:00•')
    expect(saveButton(root).disabled).toBe(false)
  })

  test('Guardar llama save_time_entries con las mismas filas y avisa al modelo', async () => {
    const root = await mount()
    host.app!.callServerTool.mockResolvedValue(asText({ insertadas: 6, actualizadas: 0, saltadas_por_edicion: 0 }))
    saveButton(root).click()
    await vi.waitFor(() => expect(root.querySelector('.saved')?.textContent).toMatch(/6 nuevas, 0 actualizadas/))

    expect(host.app!.callServerTool).toHaveBeenCalledWith({ name: 'save_time_entries', arguments: { filas: NGTECO_WEEK, nombre_archivo: 'semana.xls' } })
    expect(host.app!.updateModelContext.mock.calls[0][0].content[0].text).toMatch(/guardó el reporte del checador desde la vista/)
    expect(saveButton(root)).toBeUndefined()
  })

  test('si no cuadra, el botón queda apagado y se listan los problemas', async () => {
    const typo = NGTECO_WEEK.map((r) => (r[1] === '2026-08-31' && r[3] === '18:27' ? ['LU', '2026-08-31', '10:06', '18:57', '08:21', '08:21'] : r))
    const root = await mount(typo)
    expect(root.querySelector('.badge')?.textContent).toBe('No cuadra')
    expect(saveButton(root).disabled).toBe(true)
    expect([...root.querySelectorAll('.notes .bad')].map((li) => li.textContent)).toHaveLength(2)
  })

  test('un error al guardar se muestra y deja reintentar; el texto de las filas nunca se pinta como HTML', async () => {
    const hostile = NGTECO_WEEK.map((r) => (r[0] === 'Empleado' && r[3].startsWith('Tania') ? ['Empleado', '', '', '<img src=x onerror=alert(1)>\n(5)'] : r))
    const root = await mount(hostile)
    expect(root.querySelector('img')).toBeNull()
    host.app!.callServerTool.mockResolvedValue({ content: [{ type: 'text', text: 'No guardé nada' }], isError: true })
    saveButton(root).click()
    await vi.waitFor(() => expect(root.querySelector('.error')?.textContent).toBe('No guardé nada'))
    expect(saveButton(root).disabled).toBe(false)
  })
})
