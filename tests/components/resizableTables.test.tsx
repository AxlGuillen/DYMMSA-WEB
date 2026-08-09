/**
 * Anti-drift de columnas redimensionables (issue #55).
 *
 * El hueco que motivó este test: el arrastre se implementó en 4 tablas y las
 * de órdenes/cotizaciones —lista y detalle— se quedaron fuera; nada lo detectó
 * porque `columnWidths.test.ts` prueba el hook, no el cableado.
 *
 * Aquí se verifica lo que ese test no ve:
 *  1. que cada definición de columnas declare su `width` por defecto, y
 *  2. que las tablas rendericen una manija por columna visible.
 */

import { describe, test, expect, beforeEach, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import { renderWithProviders } from './helpers/render'
import { resetStores } from './helpers/stores'
import type { TableColumn } from '@/hooks/useVisibleColumns'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

vi.mock('@/hooks/useOrders', () => ({
  useDeleteOrder: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

vi.mock('@/hooks/useQuotations', () => ({
  useDeleteQuotation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

import { OrdersTable, ORDERS_COLUMNS } from '@/components/orders/OrdersTable'
import { QuotationsTable, QUOTATIONS_COLUMNS } from '@/components/quotations/QuotationsTable'
import { PRODUCTS_COLUMNS } from '@/components/db/ProductsTable'
import { INVENTORY_COLUMNS } from '@/components/inventory/InventoryTable'
import { CATALOG_COLUMNS } from '@/components/urrea-catalog/CatalogTable'
import { SUPPLIERS_COLUMNS } from '@/components/suppliers/SuppliersTable'

const TABLES: [string, readonly TableColumn[]][] = [
  ['orders-list', ORDERS_COLUMNS],
  ['quotations-list', QUOTATIONS_COLUMNS],
  ['products', PRODUCTS_COLUMNS],
  ['inventory', INVENTORY_COLUMNS],
  ['urrea-catalog', CATALOG_COLUMNS],
  ['suppliers', SUPPLIERS_COLUMNS],
]

describe('defaults de ancho declarados', () => {
  test.each(TABLES)('%s declara width en todas sus columnas', (_id, columns) => {
    const sinWidth = columns.filter((c) => c.width == null).map((c) => c.id)
    expect(sinWidth).toEqual([])
  })
})

/** Una manija por columna visible: `role="separator"` de ColumnResizer. */
const resizers = () => screen.getAllByRole('separator')

describe('OrdersTable', () => {
  beforeEach(() => resetStores())

  const order = {
    id: 'o1',
    name: 'Orden 1',
    odoo_id: 'S001',
    customer_name: 'Cliente',
    status: 'ordered' as const,
    items_count: 3,
    total_amount: 1000,
    created_at: '2026-08-01T00:00:00Z',
  }

  test('cada columna visible trae manija de ajuste, incluida Acciones', () => {
    renderWithProviders(
      // @ts-expect-error -- fixture mínimo: la tabla solo lee estos campos
      <OrdersTable orders={[order]} isLoading={false} />,
    )
    expect(resizers()).toHaveLength(ORDERS_COLUMNS.length)
    expect(screen.getByLabelText('Ajustar ancho de Acciones')).toBeInTheDocument()
  })

  test('el skeleton usa el mismo header (los anchos no saltan al cargar)', () => {
    renderWithProviders(<OrdersTable orders={[]} isLoading />)
    expect(resizers()).toHaveLength(ORDERS_COLUMNS.length)
  })

  test('la columna de acciones queda fija a la derecha', () => {
    renderWithProviders(
      // @ts-expect-error -- fixture mínimo
      <OrdersTable orders={[order]} isLoading={false} />,
    )
    const header = screen.getByRole('columnheader', { name: /Acciones/ })
    expect(header.className).toContain('sticky')
  })
})

describe('QuotationsTable', () => {
  beforeEach(() => resetStores())

  const quotation = {
    id: 'q1',
    name: 'Cotización 1',
    customer_name: 'Cliente',
    notes: null,
    status: 'draft' as const,
    items_count: 2,
    total_amount: 500,
    created_at: '2026-08-01T00:00:00Z',
  }

  test('cada columna visible trae manija de ajuste, incluida Acciones', () => {
    renderWithProviders(
      // @ts-expect-error -- fixture mínimo: la tabla solo lee estos campos
      <QuotationsTable quotations={[quotation]} isLoading={false} />,
    )
    expect(resizers()).toHaveLength(QUOTATIONS_COLUMNS.length)
    expect(screen.getByLabelText('Ajustar ancho de Acciones')).toBeInTheDocument()
  })

  test('la fila lleva fondo OPACO (la columna fija lo hereda con bg-inherit)', () => {
    renderWithProviders(
      // @ts-expect-error -- fixture mínimo
      <QuotationsTable quotations={[quotation]} isLoading={false} />,
    )
    const row = screen.getByRole('row', { name: /Cotización 1/ })
    // Sin `bg-background` el hover semitransparente deja ver las columnas que
    // pasan por debajo de la columna fija al hacer scroll lateral.
    expect(row.className).toContain('bg-background')
    const actions = within(row).getByTitle('Eliminar cotización').closest('td')
    expect(actions?.className).toContain('sticky')
  })
})
