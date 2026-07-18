/**
 * OrderDetail — recepción con excedente (ADR-019, issue #19).
 *
 * Cubre lo nuevo del flujo de recepción: input sin tope, hint "+N a tienda",
 * total de línea topado (excedente no se factura) y el diálogo de confirmación
 * anti-dedazo (la mutación solo corre tras el resumen). La matemática vive en
 * business-rules (tests puros); el flujo completo con BD queda para E2E.
 */

import { describe, test, expect, beforeEach, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './helpers/render'
import { resetStores } from './helpers/stores'
import { OrderDetail } from '@/components/orders/OrderDetail'
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
    // (in_stock 1 + min(10, 2)) × $100 = $300 — no $1,100
    // (aparece también en la card de total de la orden → getAllByText)
    expect(screen.getAllByText('$300.00').length).toBeGreaterThan(0)
    expect(screen.queryByText('$1,100.00')).not.toBeInTheDocument()
  })

  test('confirmar recepción pasa por el resumen anti-dedazo antes de mutar', async () => {
    const user = userEvent.setup()
    renderWithProviders(<OrderDetail order={order([orderItem()])} />)

    // Capturar 10 recibidos (pedido = 2)
    const input = screen.getByRole('spinbutton')
    await user.clear(input)
    await user.type(input, '10')

    // El botón abre el diálogo — la mutación NO corre todavía
    await user.click(screen.getByRole('button', { name: /confirmar recepción/i }))
    expect(confirmAsync).not.toHaveBeenCalled()

    // Resumen: fila con el excedente y el total de piezas a inventario
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('+8 a tienda')
    expect(dialog).toHaveTextContent('8 piezas de excedente')
    // Cantidad inusual (10 > 2×2) marcada
    expect(screen.getByLabelText('Cantidad inusual')).toBeInTheDocument()

    // Confirmar ejecuta la mutación con lo capturado
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
