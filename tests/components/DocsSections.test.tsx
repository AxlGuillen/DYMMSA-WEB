/** Docs page sections (#118): the assistant section is generated from the manifest and the quick index covers every section. */

import { describe, test, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AssistantSection, CustomersSection, FinanceSection, ProfileSection } from '@/app/dashboard/docs/sections'
import { DOCS_MANIFEST } from '@/lib/mcp/catalog'

describe('AssistantSection', () => {
  test('pinta cada capacidad del manifiesto con su pregunta ejemplo y marca las que escriben', () => {
    render(<AssistantSection tools={DOCS_MANIFEST} />)
    expect(screen.getByText(new RegExp(`${DOCS_MANIFEST.length} capacidades, ${DOCS_MANIFEST.filter((t) => t.block === 'app').length} de la app y ${DOCS_MANIFEST.filter((t) => t.block === 'odoo').length} de Odoo`))).toBeTruthy()
    for (const tool of DOCS_MANIFEST) {
      expect(screen.getAllByText(tool.title).length, tool.name).toBeGreaterThan(0)
    }
    // Only the module blocks carry the badge; the actions list repeats the limits, not the badge.
    expect(screen.getAllByText('escribe')).toHaveLength(8)
    expect(screen.getByText(/Nunca toca cantidades/)).toBeTruthy()
    // The Odoo writes are admin-only (#144): the page every member reads still lists Odoo as read-only.
    expect(DOCS_MANIFEST.some((t) => t.block === 'odoo' && t.kind === 'write')).toBe(false)
    expect(screen.getByText(/nunca publica, timbra ni envia/)).toBeTruthy()
    // Admins read this page too and they do write in Odoo (#144): no "solo lectura" claim for the block.
    expect(screen.queryByText(/Odoo: la facturacion oficial \(solo lectura\)/)).toBeNull()
  })
})

describe('FinanceSection', () => {
  test('dice donde vive la facturacion oficial y la regla de las notas de credito', () => {
    render(<FinanceSection />)
    expect(screen.getByText(/facturacion oficial/)).toBeTruthy()
    expect(screen.getByText(/nunca se restan/)).toBeTruthy()
  })
})

describe('CustomersSection', () => {
  test('dice que lo exportado no lleva RFC ni contacto y que la nota de crédito no se resta (#145)', () => {
    render(<CustomersSection />)
    expect(screen.getByText(/ni RFC ni datos de contacto/)).toBeTruthy()
    expect(screen.getByText(/no se restan/)).toBeTruthy()
    expect(screen.getByText(/fecha de vencimiento/)).toBeTruthy()
  })
})

describe('ProfileSection', () => {
  test('dice quién ve el NSS y no menciona el registro de quién pagó (ADR-028)', () => {
    const { container } = render(<ProfileSection />)
    expect(screen.getByText(/solo lo ven tu y los administradores/)).toBeTruthy()
    expect(container.textContent).not.toMatch(/pagad|bitacora|historial/i)
  })
})
