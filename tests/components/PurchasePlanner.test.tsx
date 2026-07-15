/**
 * PurchasePlanner (ADR-018): render de buckets/grupos desde un plan fijo,
 * staleness, selección de decisión y payload del guardado (consistente con
 * applyChoice). Los hooks de datos se mockean a nivel módulo; el flujo E2E
 * (guardar de verdad + regenerar Excel) queda fuera del alcance jsdom.
 */

import { describe, test, expect, beforeEach, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './helpers/render'
import { PurchasePlanner } from '@/components/orders/PurchasePlanner'
import {
  buildPurchasePlan,
  DEFAULT_PURCHASE_THRESHOLDS,
  type PlannableItem,
  type CatalogEntry,
} from '@/lib/purchase-plan'
import type { PurchasePlanResponse } from '@/hooks/usePurchasePlan'
import type { OrderPurchaseDecision } from '@/types/database'

const saveMutateAsync = vi.hoisted(() => vi.fn())
const settingsMutateAsync = vi.hoisted(() => vi.fn())

vi.mock('@/hooks/usePurchasePlan', () => ({
  useSavePurchaseDecisions: () => ({ mutateAsync: saveMutateAsync, isPending: false }),
}))
vi.mock('@/hooks/useSettings', () => ({
  useUpdateSettings: () => ({ mutateAsync: settingsMutateAsync, isPending: false }),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}))

function item(overrides: Partial<PlannableItem> = {}): PlannableItem {
  return {
    id: `i-${Math.random().toString(36).slice(2, 7)}`,
    item_type: 'product',
    etm: 'ETM-1',
    model_code: 'URR-1',
    brand: 'URREA',
    description: 'Martillo',
    section_label: null,
    quantity_to_order: 25,
    unit_price: 40,
    ...overrides,
  }
}

function makeData(
  items: PlannableItem[],
  catalog: Record<string, CatalogEntry>,
  decisions: OrderPurchaseDecision[] = [],
): PurchasePlanResponse {
  return {
    order: { id: 'o1', name: 'Orden 1', status: 'ordered', customer_name: 'ACME' },
    plan: buildPurchasePlan(
      items,
      new Map(Object.entries(catalog)),
      decisions,
      DEFAULT_PURCHASE_THRESHOLDS,
    ),
  }
}

describe('PurchasePlanner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('renderiza buckets: grupo URREA con math y compra local sin math', () => {
    const data = makeData(
      [item({ model_code: 'URR-1' }), item({ model_code: 'FUERA-1', description: 'Tornillo' })],
      { 'URREA|URR-1': { std: 10, description: 'Martillo oficial' } },
    )
    renderWithProviders(<PurchasePlanner data={data} />)

    expect(screen.getByText('Candidatos a pedido URREA (1)')).toBeInTheDocument()
    expect(screen.getByText('Compra local — sin catálogo URREA (1)')).toBeInTheDocument()
    expect(screen.getByText('Martillo oficial')).toBeInTheDocument()
    // N=25, STD=10 → excedente 5 × $40 = $200 > $100 → recomendación mixto
    expect(screen.getByText('Mixto')).toBeInTheDocument()
  })

  test('decisión guardada stale muestra el badge Desactualizada', () => {
    const data = makeData(
      [item({ quantity_to_order: 12 })],
      { 'URREA|URR-1': { std: 10, description: null } },
      [
        {
          id: 'd1', order_id: 'o1', model_code: 'URR-1', brand: 'URREA',
          std_snapshot: 10, needed_qty: 10, packages_wholesale: 1, qty_retail: 0,
          decided_at: '2026-07-15T00:00:00Z',
        },
      ],
    )
    renderWithProviders(<PurchasePlanner data={data} />)
    expect(screen.getByText('Desactualizada')).toBeInTheDocument()
  })

  test('guardar manda las cantidades de applyChoice según la selección', async () => {
    saveMutateAsync.mockResolvedValue({ decisions: [] })
    const user = userEvent.setup()
    // N=25, STD=10, $40 → recomendación mixto (floor 2 + 5 menudeo)
    const data = makeData([item()], { 'URREA|URR-1': { std: 10, description: null } })
    renderWithProviders(<PurchasePlanner data={data} />)

    // La recomendación (mixto) ya viene pre-seleccionada → guardar directo
    await user.click(screen.getByRole('button', { name: /guardar decisiones/i }))
    expect(saveMutateAsync).toHaveBeenCalledWith([
      {
        model_code: 'URR-1', brand: 'URREA', std_snapshot: 10, needed_qty: 25,
        packages_wholesale: 2, qty_retail: 5,
      },
    ])

    // Override a mayoreo → ceil(25/10)=3 paquetes, 0 menudeo
    await user.click(screen.getByRole('radio', { name: /mayoreo/i }))
    await user.click(screen.getByRole('button', { name: /guardar decisiones/i }))
    expect(saveMutateAsync).toHaveBeenLastCalledWith([
      {
        model_code: 'URR-1', brand: 'URREA', std_snapshot: 10, needed_qty: 25,
        packages_wholesale: 3, qty_retail: 0,
      },
    ])
  })

  test('grupo en "review" bloquea el guardado hasta decidir', async () => {
    const user = userEvent.setup()
    // N=2, STD=10, $10 → parked $80 ≤ 100 y pct 0.8 → review (sin selección)
    const data = makeData(
      [item({ quantity_to_order: 2, unit_price: 10 })],
      { 'URREA|URR-1': { std: 10, description: null } },
    )
    renderWithProviders(<PurchasePlanner data={data} />)

    expect(screen.getByText('Revisar')).toBeInTheDocument()
    expect(screen.getByText(/1 por revisar/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /guardar decisiones/i }))
    expect(saveMutateAsync).not.toHaveBeenCalled()

    // Decidir menudeo desbloquea
    await user.click(screen.getByRole('radio', { name: /menudeo/i }))
    await user.click(screen.getByRole('button', { name: /guardar decisiones/i }))
    expect(saveMutateAsync).toHaveBeenCalledWith([
      {
        model_code: 'URR-1', brand: 'URREA', std_snapshot: 10, needed_qty: 2,
        packages_wholesale: 0, qty_retail: 2,
      },
    ])
  })

  test('vista plana lista las líneas de origen read-only', async () => {
    const user = userEvent.setup()
    const data = makeData(
      [
        item({ section_label: 'Sección A', quantity_to_order: 5 }),
        item({ section_label: 'Sección B', quantity_to_order: 5 }),
      ],
      { 'URREA|URR-1': { std: 10, description: null } },
    )
    renderWithProviders(<PurchasePlanner data={data} />)

    // Agrupada: un solo grupo consolidado (5+5 exacto)
    expect(screen.getByText('Exacto')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Vista plana' }))
    expect(screen.getByText('Sección A')).toBeInTheDocument()
    expect(screen.getByText('Sección B')).toBeInTheDocument()
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
  })
})
