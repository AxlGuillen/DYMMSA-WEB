/** Every guided tour by id (ADR-024): TourButton starts them and the video catalog points at them (ADR-038). */

import type { OverviewStep } from './index'
import { CUT_PLANNER_TOUR } from './cut-planner'
import { DASHBOARD_TOUR } from './dashboard'
import { APPROVAL_TOUR } from './approval'
import { PURCHASE_PLANNER_TOUR } from './purchase-planner'
import { QUOTER_TOUR } from './quoter'
import { QUOTATIONS_LIST_TOUR } from './quotations-list'
import { QUOTATION_DETAIL_TOUR } from './quotation-detail'
import { ORDERS_LIST_TOUR } from './orders-list'
import { ORDER_DETAIL_TOUR } from './order-detail'
import { INVENTORY_TOUR } from './inventory'
import { ETM_DB_TOUR } from './etm-db'
import { URREA_CATALOG_TOUR } from './urrea-catalog'
import { SUPPLIERS_TOUR } from './suppliers'
import { TASKS_TOUR } from './tasks'
import { FINANCE_OVERVIEW_TOUR } from './finance-overview'
import { PAYABLES_TOUR } from './payables'
import { HOURS_TOUR } from './hours'
import { TEAM_TOUR } from './team'
import { PROFILE_TOUR } from './profile'

export const TOURS = {
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
  'finance-overview': FINANCE_OVERVIEW_TOUR,
  payables: PAYABLES_TOUR,
  hours: HOURS_TOUR,
  team: TEAM_TOUR,
  profile: PROFILE_TOUR,
} satisfies Record<string, OverviewStep[]>

export type TourId = keyof typeof TOURS
