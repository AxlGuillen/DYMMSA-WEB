/** The DYMMSA-WEB connector's tools (#155, ADR-041) in tools/list order, grouped by module as the in-app docs show them. */

import type { ToolDefinition } from '@/lib/mcp/core/define'
import { getBusinessSummaryTool } from './summary/get-business-summary'
import { listQuotationsTool } from './quotations/list-quotations'
import { getQuotationTool } from './quotations/get-quotation'
import { listOrdersTool } from './orders/list-orders'
import { getOrderTool } from './orders/get-order'
import { getCutPlanTool } from './orders/get-cut-plan'
import { saveMaterialPresentationTool } from './orders/save-material-presentation'
import { getPurchasePlanTool } from './orders/get-purchase-plan'
import { searchInventoryTool } from './inventory/search-inventory'
import { setInventoryLocationTool } from './inventory/set-inventory-location'
import { searchProductsTool } from './catalogs/search-products'
import { searchUrreaCatalogTool } from './catalogs/search-urrea-catalog'
import { listSuppliersTool } from './suppliers/list-suppliers'
import { saveSupplierTool } from './suppliers/save-supplier'
import { listPayablesTool } from './finance/list-payables'
import { getPayableTool } from './finance/get-payable'
import { getPayablesOverviewTool } from './finance/get-payables-overview'
import { markPayablePaidTool } from './finance/mark-payable-paid'
import { createPayableTool } from './finance/create-payable'
import { updatePayableTool } from './finance/update-payable'
import { getMonthClosingTool } from './finance/get-month-closing'
import { getWeekHoursTool } from './hours/get-week-hours'
import { getHoursTrendTool } from './hours/get-hours-trend'
import { listTimeImportsTool } from './hours/list-time-imports'
import { previewTimeReportTool } from './hours/preview-time-report'
import { saveTimeEntriesTool } from './hours/save-time-entries'
import { saveExcusedDayTool } from './hours/save-excused-day'
import { getProfilesTool } from './profiles/get-profiles'
import { getPayrollPeriodTool } from './payroll/get-payroll-period'
import { recordPayrollHoursTool } from './payroll/record-payroll-hours'
import { savePayrollEmployeeTool } from './payroll/save-payroll-employee'
import { listTasksTool } from './tasks/list-tasks'
import { getTaskTool } from './tasks/get-task'
import { createTaskTool } from './tasks/create-task'
import { updateTaskTool } from './tasks/update-task'
import { getAppSettingsTool } from './settings/get-app-settings'

export const DYMMSA_TOOLS: readonly ToolDefinition[] = [
  getBusinessSummaryTool,
  listQuotationsTool,
  getQuotationTool,
  listOrdersTool,
  getOrderTool,
  getCutPlanTool,
  saveMaterialPresentationTool,
  getPurchasePlanTool,
  searchInventoryTool,
  setInventoryLocationTool,
  searchProductsTool,
  searchUrreaCatalogTool,
  listSuppliersTool,
  saveSupplierTool,
  listPayablesTool,
  getPayableTool,
  getPayablesOverviewTool,
  markPayablePaidTool,
  createPayableTool,
  updatePayableTool,
  getMonthClosingTool,
  getWeekHoursTool,
  getHoursTrendTool,
  listTimeImportsTool,
  previewTimeReportTool,
  saveTimeEntriesTool,
  saveExcusedDayTool,
  getProfilesTool,
  getPayrollPeriodTool,
  recordPayrollHoursTool,
  savePayrollEmployeeTool,
  listTasksTool,
  getTaskTool,
  createTaskTool,
  updateTaskTool,
  getAppSettingsTool,
]
