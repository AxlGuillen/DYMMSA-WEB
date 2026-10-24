/** core/errors.ts (#155 C1): one mapping to isError; the per-tool translators are gone. */

import { describe, test, expect, vi, afterEach } from 'vitest'
import { DomainError } from '@/lib/domain-error'
import { GitHubError } from '@/lib/github'
import { OdooError } from '@/lib/odoo/client'
import { PayrollError } from '@/lib/payroll-store'
import { ToolError, toToolResult } from '@/lib/mcp/core/errors'

afterEach(() => vi.restoreAllMocks())

describe('toToolResult', () => {
  test.each([
    ['ToolError', new ToolError('Indica la orden')],
    ['DomainError de un store', new PayrollError('El corte que incluye el 2026-10-20 está cerrado')],
    ['DomainError failed', new DomainError('Error al crear el proveedor', 'failed')],
    ['GitHubError', new GitHubError('Token de GitHub vencido', 401)],
    ['OdooError', new OdooError('Odoo rechazó sale.order.create', 400)],
  ])('%s → isError con su mensaje tal cual, sin log', (_label, error) => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(toToolResult(error, 'save_supplier', Date.now())).toEqual({ content: [{ type: 'text', text: error.message }], isError: true })
    expect(log).not.toHaveBeenCalled()
  })

  test('cualquier otra excepción es «Error interno en <tool>» y el log dice cuál y cuánto tardó', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const boom = new TypeError("Cannot read properties of undefined (reading 'id')")
    const result = toToolResult(boom, 'get_order', Date.now() - 1234)
    expect(result).toEqual({ content: [{ type: 'text', text: 'Error interno en get_order' }], isError: true })
    expect(log).toHaveBeenCalledTimes(1)
    const [label, logged] = log.mock.calls[0]
    expect(label).toMatch(/^\[mcp\] get_order falló tras \d{4,} ms:$/)
    expect(logged).toBe(boom)
    // The model never sees the raw exception.
    expect(JSON.stringify(result)).not.toContain('Cannot read')
  })
})
