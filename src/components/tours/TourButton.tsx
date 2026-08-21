'use client'

import { Button } from '@/components/ui/button'
import { CircleHelp } from '@/components/icons'
import { startOverview, type OverviewStep } from '@/lib/tours'
import { CUT_PLANNER_TOUR } from '@/lib/tours/cut-planner'
import { DASHBOARD_TOUR } from '@/lib/tours/dashboard'
import { APPROVAL_TOUR } from '@/lib/tours/approval'
import { PURCHASE_PLANNER_TOUR } from '@/lib/tours/purchase-planner'
import { QUOTER_TOUR } from '@/lib/tours/quoter'
import { QUOTATIONS_LIST_TOUR } from '@/lib/tours/quotations-list'
import { QUOTATION_DETAIL_TOUR } from '@/lib/tours/quotation-detail'
import { ORDERS_LIST_TOUR } from '@/lib/tours/orders-list'
import { ORDER_DETAIL_TOUR } from '@/lib/tours/order-detail'
import { INVENTORY_TOUR } from '@/lib/tours/inventory'
import { ETM_DB_TOUR } from '@/lib/tours/etm-db'
import { URREA_CATALOG_TOUR } from '@/lib/tours/urrea-catalog'
import { SUPPLIERS_TOUR } from '@/lib/tours/suppliers'
import { TASKS_TOUR } from '@/lib/tours/tasks'

const TOURS = {
  dashboard: DASHBOARD_TOUR,
  'cut-planner': CUT_PLANNER_TOUR,
  approval: APPROVAL_TOUR,
  'purchase-planner': PURCHASE_PLANNER_TOUR,
  quoter: QUOTER_TOUR,
  'quotations-list': QUOTATIONS_LIST_TOUR,
  'quotation-detail': QUOTATION_DETAIL_TOUR,
  'orders-list': ORDERS_LIST_TOUR,
  'order-detail': ORDER_DETAIL_TOUR,
  inventory: INVENTORY_TOUR,
  'etm-db': ETM_DB_TOUR,
  'urrea-catalog': URREA_CATALOG_TOUR,
  suppliers: SUPPLIERS_TOUR,
  tasks: TASKS_TOUR,
} satisfies Record<string, OverviewStep[]>

export type TourId = keyof typeof TOURS

/**
 * Botón "Vista guiada" — la ÚNICA puerta a los tours (ADR-024): siempre
 * opcionales, nunca se lanzan solos. El id resuelve los pasos aquí (client)
 * para que las páginas server puedan colocarlo sin pasar funciones.
 */
export function TourButton({ tour, className }: { tour: TourId; className?: string }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className={className}
      aria-label="Vista guiada"
      onClick={() => startOverview(TOURS[tour])}
    >
      <CircleHelp className="mr-2 size-4" />
      Vista guiada
    </Button>
  )
}
