/** MCP App views (ADR-036): the committed HTML must be rebuilt whenever its sources change. */

import { describe, test, expect } from 'vitest'
import { MCP_VIEWS } from '@/lib/mcp/views/generated'
import { PRODUCTS_AUTHORIZATION_META } from '@/lib/odoo/preview-token'
import { VIEWS, viewDir, viewSourceHash } from '../../scripts/mcp-views'
import { readdirSync, readFileSync } from 'node:fs'
import {
  altaArguments,
  applyToolResult,
  assignArguments,
  assignChoiceKey,
  assignedSummary,
  AUTHORIZATION_META,
  dataOf,
  NOTHING_CHOSEN,
  defaultSatChoice,
  initialState,
  newChoiceKey,
  OTHER_SAT,
  SAT_PLACEHOLDER as VIEW_SAT_PLACEHOLDER,
  satOptions,
  type ViewState,
} from '@/mcp-views/odoo-quotation/state'
import type { QuotationPreview } from '@/lib/mcp/tools/odoo/quotations'
import { SAT_PLACEHOLDER } from '@/lib/odoo/sat-keys'
import { join } from 'node:path'
import { odooConnector } from '@/lib/mcp/connectors/odoo/connector'
import { authAs, connectMcp } from './harness'

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
    const admin = await connectMcp('admin')
    const member = await connectMcp('member')
    try {
      const tool = (await admin.tools()).find((t) => t.name === 'preview_time_report')
      expect(tool?._meta).toMatchObject({ ui: { resourceUri: 'ui://dymmsa/time-report.html' }, 'ui/resourceUri': 'ui://dymmsa/time-report.html' })
      expect(tool?.annotations?.readOnlyHint).toBe(true)
      const read = await admin.client.readResource({ uri: 'ui://dymmsa/time-report.html' })
      expect(read.contents[0]).toMatchObject({ mimeType: 'text/html;profile=mcp-app', text: MCP_VIEWS['time-report'].html })

      expect((await member.tools()).map((t) => t.name)).not.toContain('preview_time_report')
      await expect(member.client.listResources()).rejects.toThrow()
    } finally {
      await Promise.all([admin.close(), member.close()])
    }
  })

  test('ninguna vista empaqueta código del servidor: de src/lib solo toma tipos, como el z.infer de su output (#155 C3)', () => {
    for (const name of VIEWS) {
      for (const file of readdirSync(viewDir(name)).filter((f) => f.endsWith('.ts'))) {
        const source = readFileSync(join(viewDir(name), file), 'utf8')
        expect(source, `${name}/${file}`).not.toMatch(/^import (?!type )[^\n]*(@\/lib\/|'zod')/m)
      }
    }
    const timeReport = readFileSync(join(viewDir('time-report'), 'main.ts'), 'utf8')
    expect(timeReport).toMatch(/type Preview = z\.infer<typeof previewTimeReportOutput>/)
  })

  test('cotización de Odoo (#144): la vista lee la autorización de la misma llave de _meta y no empaqueta código del servidor', () => {
    expect(AUTHORIZATION_META).toBe(PRODUCTS_AUTHORIZATION_META)
    expect(VIEW_SAT_PLACEHOLDER).toBe(SAT_PLACEHOLDER)
    for (const file of readdirSync(viewDir('odoo-quotation')).filter((f) => f.endsWith('.ts'))) {
      const source = readFileSync(join(viewDir('odoo-quotation'), file), 'utf8')
      expect(source, file).not.toMatch(/^import (?!type )[^\n]*@\/lib\//m)
    }
    expect(MCP_VIEWS['odoo-quotation'].html).not.toMatch(/node:crypto|createHmac/)
  })

  test('cotización de Odoo con el SDK real: la vista previa trae su vista, el alta de productos solo la ve la vista y un member no ve nada (#144)', async () => {
    const admin = await connectMcp('admin', authAs('admin'), odooConnector)
    const member = await connectMcp('member', authAs('member'), odooConnector)
    const dymmsa = await connectMcp('admin')
    try {
      // Since #155 B3 the view lives only in «Odoo DYMMSA».
      expect((await dymmsa.client.listResources()).resources.map((r) => r.uri)).toEqual(['ui://dymmsa/time-report.html'])
      const list = await admin.tools()
      const preview = list.find((t) => t.name === 'odoo_preview_quotation')
      expect(preview?._meta).toMatchObject({ ui: { resourceUri: 'ui://dymmsa/odoo-quotation.html' } })
      expect(preview?.annotations?.readOnlyHint).toBe(true)
      expect(list.find((t) => t.name === 'odoo_save_product')?._meta).toMatchObject({ ui: { visibility: ['app'] } })
      for (const name of ['odoo_save_quotation', 'odoo_confirm_quotation', 'odoo_save_product', 'odoo_create_draft_invoice']) {
        expect(list.find((t) => t.name === name)?.annotations?.readOnlyHint, name).toBe(false)
      }
      const read = await admin.client.readResource({ uri: 'ui://dymmsa/odoo-quotation.html' })
      expect(read.contents[0]).toMatchObject({ mimeType: 'text/html;profile=mcp-app', text: MCP_VIEWS['odoo-quotation'].html })

      const memberTools = (await member.tools()).map((t) => t.name)
      for (const name of ['odoo_preview_quotation', 'odoo_save_quotation', 'odoo_confirm_quotation', 'odoo_save_product', 'odoo_create_draft_invoice']) {
        expect(memberTools, name).not.toContain(name)
      }
    } finally {
      await Promise.all([admin.close(), member.close(), dymmsa.close()])
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

    test('lee el structuredContent cuando el host lo pasa, y el texto cuando no (#155 C3)', () => {
      const structured = { ...ok, content: [{ type: 'text' as const, text: '{"modo":' }], structuredContent: preview as unknown as Record<string, unknown> }
      expect(applyToolResult(initialState(), structured)).toMatchObject({ preview, autorizacion: 'firma', error: null })
      expect(dataOf(structured)).toEqual(preview)
      expect(dataOf({ content: ok.content })).toEqual(preview)
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

  describe('cotización de Odoo: la clave SAT que elige el administrador (#154)', () => {
    const AEROSOL = { clave: '31211507', nombre: 'Pinturas en aerosol' }
    const PINTURAS = { clave: '31211500', nombre: 'Pinturas' }
    const sat = { categoria_sat: null, clave_sat_propuesta: null }
    const preview = {
      modo: 'crear',
      puede_guardar: true,
      productos_para_alta: [
        { codigo: 'ZZAERO', descripcion: 'Aerosol', precio: 56.03 },
        { codigo: '7230', descripcion: 'Pinza', precio: 120, clave_sat: '27112100' },
      ],
      productos_nuevos: [
        { ...sat, nombre_en_odoo: 'ZZAERO Aerosol', clave_sat: null, sugerencias_sat: [AEROSOL, PINTURAS] },
        { ...sat, nombre_en_odoo: '7230 Pinza', clave_sat: '27112100', sugerencias_sat: [] },
      ],
      sin_clave_sat: [
        { ...sat, producto_id: 16980, nombre: 'Aerosol viejo', lineas: [3], clave_sat: null, categoria_sat: 'pinturas en aerosol', clave_sat_propuesta: '31211507', sugerencias_sat: [AEROSOL] },
        { ...sat, producto_id: 16971, nombre: 'Mango', lineas: [4], clave_sat: null, sugerencias_sat: [] },
      ],
    } as unknown as QuotationPreview
    const loaded = (choices: ViewState['choices'] = {}): ViewState => ({
      ...applyToolResult(initialState(), { content: [{ type: 'text', text: JSON.stringify(preview) }], _meta: { [PRODUCTS_AUTHORIZATION_META]: 'firma' } }),
      choices,
    })

    test('las opciones: sin clave, la de la cotización, las sugeridas y teclear otra', () => {
      expect(satOptions(preview.productos_nuevos[0]).map((o) => o.value)).toEqual(['', '31211507', '31211500', OTHER_SAT])
      expect(satOptions(preview.productos_nuevos[1]).map((o) => o.value)).toEqual(['', '27112100', OTHER_SAT])
      // Preselected: the chat's key or the one categoria_sat found alone; a plain suggestion waits for the admin.
      expect(defaultSatChoice(preview.productos_nuevos[0]).value).toBe('')
      expect(defaultSatChoice(preview.productos_nuevos[1]).value).toBe('27112100')
      expect(defaultSatChoice(preview.sin_clave_sat[0]).value).toBe('31211507')
    })

    test('el alta manda productos_para_alta tal cual, con la clave elegida, y marca la tecleada', () => {
      const plain = altaArguments(loaded())
      expect(plain).toEqual({
        ready: true,
        args: {
          productos: [
            { codigo: 'ZZAERO', descripcion: 'Aerosol', precio: 56.03 },
            { codigo: '7230', descripcion: 'Pinza', precio: 120, clave_sat: '27112100' },
          ],
          autorizacion: 'firma',
        },
      })
      const picked = altaArguments(
        loaded({ [newChoiceKey(0)]: { value: '31211500', typed: '' }, [newChoiceKey(1)]: { value: OTHER_SAT, typed: ' 27112101 ' } }),
      )
      expect(picked.ready && picked.args.productos).toEqual([
        { codigo: 'ZZAERO', descripcion: 'Aerosol', precio: 56.03, clave_sat: '31211500' },
        { codigo: '7230', descripcion: 'Pinza', precio: 120, clave_sat: '27112101', clave_sat_tecleada: true },
      ])
      // Choosing "sin clave" drops the chat's one.
      const dropped = altaArguments(loaded({ [newChoiceKey(1)]: { value: '', typed: '' } }))
      expect(dropped.ready && dropped.args.productos[1]).toEqual({ codigo: '7230', descripcion: 'Pinza', precio: 120 })
    })

    test('una clave tecleada incompleta o 01010101 apaga el botón y dice por qué', () => {
      expect(altaArguments(loaded({ [newChoiceKey(0)]: { value: OTHER_SAT, typed: '3121' } }))).toEqual({
        ready: false,
        reason: 'ZZAERO Aerosol: la clave SAT lleva 8 dígitos.',
      })
      expect(altaArguments(loaded({ [newChoiceKey(0)]: { value: OTHER_SAT, typed: SAT_PLACEHOLDER } }))).toMatchObject({
        ready: false,
        reason: expect.stringMatching(/^ZZAERO Aerosol: 01010101 significa «no existe en el catálogo»/),
      })
    })

    test('asignar manda solo los productos con clave; sin ninguna elegida el botón queda apagado y dice por qué', () => {
      expect(assignArguments(loaded())).toEqual({
        ready: true,
        args: { asignar: [{ producto_id: 16980, clave_sat: '31211507' }], autorizacion: 'firma' },
      })
      const typed = assignArguments(loaded({ [assignChoiceKey(16971)]: { value: OTHER_SAT, typed: '27111700' } }))
      expect(typed.ready && typed.args.asignar).toEqual([
        { producto_id: 16980, clave_sat: '31211507' },
        { producto_id: 16971, clave_sat: '27111700', clave_sat_tecleada: true },
      ])
      expect(assignArguments(loaded({ [assignChoiceKey(16980)]: { value: '', typed: '' } }))).toEqual({
        ready: false,
        reason: 'Elige la clave SAT de al menos un producto.',
      })
      expect(NOTHING_CHOSEN).toBe('Elige la clave SAT de al menos un producto.')
      // Without the authorization there is no button at all, so nothing to say.
      expect(assignArguments({ ...loaded(), autorizacion: null })).toEqual({ ready: false, reason: null })
    })

    test('lo que se le dice al modelo tras asignar: una clave que Odoo no nombró no sale como código (review PR #167)', () => {
      expect(
        assignedSummary({
          asignados: [{ id: 16980, nombre: 'Aerosol viejo', clave_sat: '31211507' }],
          ya_tenian: [
            { id: 16971, nombre: 'Mango', clave_sat: '27111700 Llaves' },
            { id: 5, nombre: 'Brocha', clave_sat: null },
          ],
        }),
      ).toBe(
        'El administrador asignó la clave SAT en Odoo desde la vista: Aerosol viejo (#16980) → 31211507. Ya tenían clave en Odoo (no se tocó): Mango (#16971) → 27111700 Llaves, Brocha (#5) (ya tenía clave).',
      )
      expect(assignedSummary({ asignados: [], ya_tenian: [] })).toBe('El administrador asignó la clave SAT en Odoo desde la vista: ninguna.')
    })

    test('un resultado nuevo borra las elecciones y lo asignado', () => {
      const before = { ...loaded({ [newChoiceKey(0)]: { value: '31211507', typed: '' } }), assigned: { asignados: [], ya_tenian: [] }, assignError: 'x' }
      expect(applyToolResult(before, { content: [{ type: 'text', text: JSON.stringify(preview) }] })).toMatchObject({
        choices: {},
        assigned: null,
        assignError: null,
      })
    })
  })
})
