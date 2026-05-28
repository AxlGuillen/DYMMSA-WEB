import { describe, test, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QuotationStatusBadge } from '@/components/quotations/QuotationStatusBadge'
import { OrderStatusBadge } from '@/components/orders/OrderStatusBadge'
import type { QuotationStatus, OrderStatus } from '@/types/database'

describe('QuotationStatusBadge', () => {
  const cases: Array<[QuotationStatus, string]> = [
    ['draft', 'Borrador'],
    ['sent_for_approval', 'En aprobación'],
    ['approved', 'Aprobada'],
    ['rejected', 'Rechazada'],
    ['converted_to_order', 'Convertida'],
  ]

  test.each(cases)('status "%s" → label "%s"', (status, label) => {
    render(<QuotationStatusBadge status={status} />)
    expect(screen.getByText(label)).toBeInTheDocument()
  })
})

describe('OrderStatusBadge', () => {
  const cases: Array<[OrderStatus, string]> = [
    ['ordered', 'Pedido'],
    ['received', 'Recibido'],
    ['delivered', 'Entregado'],
    ['completed', 'Completado'],
    ['cancelled', 'Cancelado'],
  ]

  test.each(cases)('status "%s" → label "%s"', (status, label) => {
    render(<OrderStatusBadge status={status} />)
    expect(screen.getByText(label)).toBeInTheDocument()
  })

  test('renderiza el punto de color (dot) junto al label', () => {
    const { container } = render(<OrderStatusBadge status="ordered" />)
    // El dot es un <span> con la clase de color de fondo del estado.
    expect(container.querySelector('span.bg-yellow-500')).toBeTruthy()
  })
})
