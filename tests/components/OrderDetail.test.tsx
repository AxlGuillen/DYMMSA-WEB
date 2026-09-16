/** OrderDetail reception with excess (ADR-019, #19). The math lives in business-rules. */

import { describe, test, expect, beforeEach, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './helpers/render'
import { resetStores } from './helpers/stores'
import { OrderDetail } from '@/components/orders/OrderDetail'
import { ORDER_DETAIL_TOUR } from '@/lib/tours/order-detail'
import type { OrderWithItems, OrderItem } from '@/types/database'

const { confirmAsync } = vi.hoisted(() => ({
  confirmAsync: vi.fn().mockResolvedValue({ success: true, inventory_updated: 1, warnings: [] }),
}))

vi.mock('@/hooks/useOrders', () => ({
  ORDERS_KEY: ['orders'],
  useUpdateOrderStatus: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useConfirmReception: () => ({ mutateAsync: confirmAsync, isPending: false }),
  useCancelOrder: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteOrder: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useAddOrderItem: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useEditOrderItem: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useEditDeliveryTime: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRemoveOrderItem: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateOrderOdooId: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

vi.mock('driver.js', () => ({ driver: vi.fn(() => ({ drive: vi.fn() })) }))
vi.mock('driver.js/dist/driver.css', () => ({}))

vi.mock('@/hooks/usePurchasePlan', () => ({
  usePurchasePlan: () => ({ data: undefined }),
  useSavePurchaseDecisions: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}))

function orderItem(overrides: Partial<OrderItem> = {}): OrderItem {
  return {
    id: 'it1',
    order_id: 'o1',
    item_type: 'product',
    section_label: null,
    sort_order: 0,
    etm: 'ETM-1',
    model_code: 'MC1',
    description: 'Martillo',
    brand: 'URREA',
    quantity_approved: 3,
    quantity_in_stock: 1,
    quantity_to_order: 2,
    quantity_received: 0,
    urrea_status: 'pending',
    delivery_time: 'immediate',
    unit_price: 100,
    location: null,
    created_at: '2026-07-16T00:00:00Z',
    ...overrides,
  }
}

function order(items: OrderItem[], overrides: Partial<OrderWithItems> = {}): OrderWithItems {
  return {
    id: 'o1',
    name: 'Orden test',
    customer_name: 'ACME',
    status: 'ordered',
    total_amount: 300,
    original_file_url: null,
    urrea_order_file_url: null,
    notes: null,
    odoo_id: null,
    created_at: '2026-07-16T00:00:00Z',
    updated_at: '2026-07-16T00:00:00Z',
    created_by: null,
    order_items: items,
    ...overrides,
  }
}

describe('OrderDetail — recepción con excedente', () => {
  beforeEach(() => {
    resetStores()
    vi.clearAllMocks()
    confirmAsync.mockResolvedValue({ success: true, inventory_updated: 1, warnings: [] })
  })

  test('el input de recibidos ya no tiene tope (max)', () => {
    renderWithProviders(<OrderDetail order={order([orderItem()])} />)
    const input = screen.getByRole('spinbutton')
    expect(input).not.toHaveAttribute('max')
  })

  test('muestra el hint "+N a tienda" cuando lo recibido supera lo pedido', () => {
    renderWithProviders(
      <OrderDetail order={order([orderItem({ quantity_received: 10, quantity_to_order: 2 })])} />,
    )
    expect(screen.getByText('+8 a tienda')).toBeInTheDocument()
  })

  test('sin excedente no hay hint', () => {
    renderWithProviders(
      <OrderDetail order={order([orderItem({ quantity_received: 2, quantity_to_order: 2 })])} />,
    )
    expect(screen.queryByText(/a tienda/)).not.toBeInTheDocument()
  })

  test('REGLA (ADR-019): el total de línea NO factura el excedente', () => {
    renderWithProviders(
      <OrderDetail
        order={order([
          orderItem({
            quantity_in_stock: 1, quantity_received: 10, quantity_to_order: 2,
            urrea_status: 'supplied', unit_price: 100,
          }),
        ])}
      />,
    )
    // (in_stock 1 + min(10, 2)) × $100 = $300, not $1,100.
    // Also shown on the order total card → getAllByText.
    expect(screen.getAllByText('$300.00').length).toBeGreaterThan(0)
    expect(screen.queryByText('$1,100.00')).not.toBeInTheDocument()
  })

  test('confirmar recepción pasa por el resumen anti-dedazo antes de mutar', async () => {
    const user = userEvent.setup()
    renderWithProviders(<OrderDetail order={order([orderItem()])} />)

    const input = screen.getByRole('spinbutton')
    await user.clear(input)
    await user.type(input, '10')

    // The button opens the dialog; the mutation does NOT run yet.
    await user.click(screen.getByRole('button', { name: /confirmar recepción/i }))
    expect(confirmAsync).not.toHaveBeenCalled()

    // Summary: the excess row and the total of pieces going to inventory.
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('+8 a tienda')
    expect(dialog).toHaveTextContent('8 piezas de excedente')
    // Unusual quantity (10 > 2×2) flagged.
    expect(screen.getByLabelText('Cantidad inusual')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /sí, confirmar recepción/i }))
    expect(confirmAsync).toHaveBeenCalledWith({
      orderId: 'o1',
      input: { items: [{ id: 'it1', quantity_received: 10, urrea_status: 'pending' }] },
    })
  })

  test('"Revisar de nuevo" cierra el diálogo sin mutar', async () => {
    const user = userEvent.setup()
    renderWithProviders(<OrderDetail order={order([orderItem()])} />)

    const input = screen.getByRole('spinbutton')
    await user.clear(input)
    await user.type(input, '5')
    await user.click(screen.getByRole('button', { name: /confirmar recepción/i }))
    await screen.findByRole('alertdialog')

    await user.click(screen.getByRole('button', { name: /revisar de nuevo/i }))
    expect(confirmAsync).not.toHaveBeenCalled()
  })
})

describe('OrderDetail — columnas redimensionables (issue #55)', () => {
  beforeEach(() => resetStores())

  test('la tabla de ítems trae manija de ajuste en sus columnas', () => {
    renderWithProviders(<OrderDetail order={order([orderItem()])} />)
    expect(screen.getByLabelText('Ajustar ancho de Descripción')).toBeInTheDocument()
    expect(screen.getByLabelText('Ajustar ancho de Acciones')).toBeInTheDocument()
  })

  test('Acciones queda fija a la derecha (no se va con el scroll lateral)', () => {
    renderWithProviders(<OrderDetail order={order([orderItem()])} />)
    const header = screen.getByRole('columnheader', { name: /Acciones/ })
    expect(header.className).toContain('sticky')
  })
})

describe('OrderDetail — vista guiada (issue #74)', () => {
  beforeEach(() => resetStores())

  test('anti-drift: en una orden activa existen los 5 bloques del tour', () => {
    renderWithProviders(<OrderDetail order={order([orderItem()])} />)
    for (const step of ORDER_DETAIL_TOUR) {
      expect(document.querySelector(step.selector), step.selector).not.toBeNull()
    }
  })

  test('en cancelada desaparecen estado y notas — el tour los salta sin tronar', () => {
    renderWithProviders(<OrderDetail order={order([orderItem()], { status: 'cancelled' })} />)
    expect(document.querySelector('[data-tour="od-status"]')).toBeNull()
    expect(document.querySelector('[data-tour="od-notes"]')).toBeNull()
    expect(document.querySelector('[data-tour="od-items"]')).not.toBeNull()
  })
})
