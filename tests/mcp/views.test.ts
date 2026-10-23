/** MCP App views (ADR-036): the committed HTML must be rebuilt whenever its sources change. */

import { describe, test, expect } from 'vitest'
import { MCP_VIEWS } from '@/lib/mcp/views/generated'
import { PRODUCTS_AUTHORIZATION_META } from '@/lib/odoo/preview-token'
import { VIEWS, viewDir, viewSourceHash } from '../../scripts/mcp-views'
import { readdirSync, readFileSync } from 'node:fs'
import { applyToolResult, AUTHORIZATION_META, initialState } from '@/mcp-views/odoo-quotation/state'
import type { QuotationPreview } from '@/lib/mcp/tools/odoo/quotations'
import { join } from 'node:path'
import { connectMcp } from './harness'

describe('vistas MCP generadas', () => {
  test('cada vista está generada y al día con su código (si falla: bun run build:mcp-views)', () => {
    expect(Object.keys(MCP_VIEWS).sort()).toEqual([...VIEWS].sort())
    for (const name of VIEWS) expect(MCP_VIEWS[name].sourceHash, name).toBe(viewSourceHash(name))
  })

  test('el HTML es autocontenido: sin scripts, estilos ni fuentes externas', () => {
    for (const name of VIEWS) {
      const { html } = MCP_VIEWS[name]
      expect(html).toMatch(/^<!doctype html>/)
      expect(html).toContain('<main id="app"></main>')
      expect(html).not.toMatch(/<(script|link)[^>]+(src|href)=/i)
      expect(html).not.toMatch(/@import\s+url\(\s*['"]?https?:/i)
    }
  })

  test('con el SDK real: el admin ve la tool con _meta.ui y lee el HTML; un member no ve ni la tool ni la vista', async () => {
    const admin = (await connectMcp('admin')).client
    const tool = (await admin.listTools()).tools.find((t) => t.name === 'preview_time_report')
    expect(tool?._meta).toMatchObject({ ui: { resourceUri: 'ui://dymmsa/time-report.html' }, 'ui/resourceUri': 'ui://dymmsa/time-report.html' })
    expect(tool?.annotations?.readOnlyHint).toBe(true)
    const read = await admin.readResource({ uri: 'ui://dymmsa/time-report.html' })
    expect(read.contents[0]).toMatchObject({ mimeType: 'text/html;profile=mcp-app', text: MCP_VIEWS['time-report'].html })

    const member = (await connectMcp('member')).client
    expect((await member.listTools()).tools.map((t) => t.name)).not.toContain('preview_time_report')
    await expect(member.listResources()).rejects.toThrow()
  })

  test('cotización de Odoo (#144): la vista lee la autorización de la misma llave de _meta y no empaqueta código del servidor', () => {
    expect(AUTHORIZATION_META).toBe(PRODUCTS_AUTHORIZATION_META)
    for (const file of readdirSync(viewDir('odoo-quotation')).filter((f) => f.endsWith('.ts'))) {
      const source = readFileSync(join(viewDir('odoo-quotation'), file), 'utf8')
      expect(source, file).not.toMatch(/^import (?!type )[^\n]*@\/lib\//m)
    }
    expect(MCP_VIEWS['odoo-quotation'].html).not.toMatch(/node:crypto|createHmac/)
  })

  test('cotización de Odoo con el SDK real: la vista previa trae su vista, el alta de productos solo la ve la vista y un member no ve nada (#144)', async () => {
    const { client } = await connectMcp('admin')
    const list = (await client.listTools()).tools
    const preview = list.find((t) => t.name === 'odoo_preview_quotation')
    expect(preview?._meta).toMatchObject({ ui: { resourceUri: 'ui://dymmsa/odoo-quotation.html' } })
    expect(preview?.annotations?.readOnlyHint).toBe(true)
    expect(list.find((t) => t.name === 'odoo_save_product')?._meta).toMatchObject({ ui: { visibility: ['app'] } })
    for (const name of ['odoo_save_quotation', 'odoo_save_product', 'odoo_create_draft_invoice']) {
      expect(list.find((t) => t.name === name)?.annotations?.readOnlyHint, name).toBe(false)
    }
    const read = await client.readResource({ uri: 'ui://dymmsa/odoo-quotation.html' })
    expect(read.contents[0]).toMatchObject({ mimeType: 'text/html;profile=mcp-app', text: MCP_VIEWS['odoo-quotation'].html })

    const member = (await (await connectMcp('member')).tools()).map((t) => t.name)
    for (const name of ['odoo_preview_quotation', 'odoo_save_quotation', 'odoo_save_product', 'odoo_create_draft_invoice']) {
      expect(member, name).not.toContain(name)
    }
  })

  describe('cotización de Odoo: lo que un resultado le hace a la vista (#144, review PR #152)', () => {
    const preview = { modo: 'crear', productos_para_alta: [{ codigo: 'X1', descripcion: 'Uno', precio: 1 }], puede_guardar: true } as unknown as QuotationPreview
    const ok = { content: [{ type: 'text' as const, text: JSON.stringify(preview) }], _meta: { [PRODUCTS_AUTHORIZATION_META]: 'firma' } }

    test('un resultado bueno trae la vista previa y la autorización del _meta, nunca del texto', () => {
      const state = applyToolResult(initialState(), ok)
      expect(state.preview).toEqual(preview)
      expect(state.autorizacion).toBe('firma')
      expect(applyToolResult(initialState(), { content: ok.content }).autorizacion).toBeNull()
    })

    test('un error después de una vista previa buena la quita y deja ver el error (con su botón de alta fuera)', () => {
      const saved = { ...applyToolResult(initialState(), ok), saved: { creados: [], ya_existian: [], sin_clave_sat: 0 } }
      const state = applyToolResult(saved, { isError: true, content: [{ type: 'text', text: 'La vista previa venció' }] })
      expect(state).toMatchObject({ preview: null, autorizacion: null, error: 'La vista previa venció', saved: null })
    })

    test('una respuesta truncada también es error, y la siguiente buena limpia el error y el alta anterior', () => {
      const broken = applyToolResult(applyToolResult(initialState(), ok), { content: [{ type: 'text', text: '{"modo":' }] })
      expect(broken).toMatchObject({ preview: null, autorizacion: null })
      expect(broken.error).toMatch(/incompleta/)
      const again = applyToolResult({ ...broken, saved: { creados: [], ya_existian: [], sin_clave_sat: 0 }, saveError: 'x' }, ok)
      expect(again).toMatchObject({ error: null, saved: null, saveError: null, autorizacion: 'firma' })
    })
  })
})
