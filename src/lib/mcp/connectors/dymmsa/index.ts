/** The DYMMSA-WEB connector's tools (#155, ADR-041) in tools/list order, grouped by module as the in-app docs show them. */

import type { ToolDefinition } from '@/lib/mcp/core/define'
import { getBusinessSummaryTool } from './summary/get-business-summary'
import { listQuotationsTool } from './quotations/list-quotations'
import { getQuotationTool } from './quotations/get-quotation'
import { saveQuotationTool } from './quotations/save-quotation'
import { listOrdersTool } from './orders/list-orders'
import { getOrderTool } from './orders/get-order'
import { getCutPlanTool } from './orders/get-cut-plan'
import { saveMaterialPresentationTool } from './orders/save-material-presentation'
import { getPurchasePlanTool } from './orders/get-purchase-plan'
import { searchInventoryTool } from './inventory/search-inventory'
import { saveInventoryItemTool } from './inventory/save-inventory-item'
import { searchProductsTool } from './catalogs/search-products'
import { saveProductTool } from './catalogs/save-product'
import { searchUrreaCatalogTool } from './catalogs/search-urrea-catalog'
import { saveUrreaCatalogItemTool } from './catalogs/save-urrea-catalog-item'
import { listSuppliersTool } from './suppliers/list-suppliers'
import { saveSupplierTool } from './suppliers/save-supplier'
import { listPayablesTool } from './finance/list-payables'
import { getPayableTool } from './finance/get-payable'
import { getPayablesOverviewTool } from './finance/get-payables-overview'
import { savePayableTool } from './finance/save-payable'
import { getMonthClosingTool } from './finance/get-month-closing'
import { getWeekHoursTool } from './hours/get-week-hours'
import { getHoursTrendTool } from './hours/get-hours-trend'
import { listTimeImportsTool } from './hours/list-time-imports'
import { previewTimeReportTool } from './hours/preview-time-report'
import { saveTimeEntriesTool } from './hours/save-time-entries'
import { saveExcusedDayTool } from './hours/save-excused-day'
import { listProfilesTool } from './profiles/list-profiles'
import { saveProfileTool } from './profiles/save-profile'
import { getPayrollPeriodTool } from './payroll/get-payroll-period'
import { savePayrollHoursTool } from './payroll/save-payroll-hours'
import { savePayrollEmployeeTool } from './payroll/save-payroll-employee'
import { savePayrollPeriodTool } from './payroll/save-payroll-period'
import { listTasksTool } from './tasks/list-tasks'
import { getTaskTool } from './tasks/get-task'
import { saveTaskTool } from './tasks/save-task'
import { getAppSettingsTool } from './settings/get-app-settings'
import { saveAppSettingsTool } from './settings/save-app-settings'
import { deleteRecordTool } from './records/delete-record'

export const DYMMSA_TOOLS: readonly ToolDefinition[] = [
  getBusinessSummaryTool,
  listQuotationsTool,
  getQuotationTool,
  saveQuotationTool,
  listOrdersTool,
  getOrderTool,
  getCutPlanTool,
  saveMaterialPresentationTool,
  getPurchasePlanTool,
  searchInventoryTool,
  saveInventoryItemTool,
  searchProductsTool,
  saveProductTool,
  searchUrreaCatalogTool,
  saveUrreaCatalogItemTool,
  listSuppliersTool,
  saveSupplierTool,
  listPayablesTool,
  getPayableTool,
  getPayablesOverviewTool,
  savePayableTool,
  getMonthClosingTool,
  getWeekHoursTool,
  getHoursTrendTool,
  listTimeImportsTool,
  previewTimeReportTool,
  saveTimeEntriesTool,
  saveExcusedDayTool,
  listProfilesTool,
  saveProfileTool,
  getPayrollPeriodTool,
  savePayrollHoursTool,
  savePayrollEmployeeTool,
  savePayrollPeriodTool,
  listTasksTool,
  getTaskTool,
  saveTaskTool,
  getAppSettingsTool,
  saveAppSettingsTool,
  deleteRecordTool,
]
