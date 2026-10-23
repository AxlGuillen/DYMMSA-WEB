/** The Odoo DYMMSA connector's tools (#155, ADR-041) in tools/list order: reads, then the admin-only writes of ADR-040. */

import type { ToolDefinition } from '@/lib/mcp/core/define'
import { odooQueryTool } from './queries/odoo-query'
import { odooAggregateTool } from './queries/odoo-aggregate'
import { odooOverdueInvoicesTool } from './accounting/odoo-overdue-invoices'
import { odooInvoicesSummaryTool } from './accounting/odoo-invoices-summary'
import { odooSalesSummaryTool } from './sales/odoo-sales-summary'
import { odooCustomerProfileTool } from './sales/odoo-customer-profile'
import { odooReceivablesRankingTool } from './sales/odoo-receivables-ranking'
import { odooInvoiceDetailTool } from './accounting/odoo-invoice-detail'
import { odooSaleDetailTool } from './sales/odoo-sale-detail'
import { odooPaymentDetailTool } from './accounting/odoo-payment-detail'
import { odooRepAuditTool } from './accounting/odoo-rep-audit'
import { odooInvoiceLinkCheckTool } from './accounting/odoo-invoice-link-check'
import { odooStockCheckTool } from './operations/odoo-stock-check'
import { odooEmployeeDirectoryTool } from './operations/odoo-employee-directory'
import { odooFleetStatusTool } from './operations/odoo-fleet-status'
import { odooPreviewQuotationTool } from './quotations/odoo-preview-quotation'
import { odooSaveQuotationTool } from './quotations/odoo-save-quotation'
import { odooSaveProductTool } from './quotations/odoo-save-product'
import { odooCreateDraftInvoiceTool } from './quotations/odoo-create-draft-invoice'

export const ODOO_TOOLS: readonly ToolDefinition[] = [
  odooQueryTool,
  odooAggregateTool,
  odooOverdueInvoicesTool,
  odooInvoicesSummaryTool,
  odooSalesSummaryTool,
  odooCustomerProfileTool,
  odooReceivablesRankingTool,
  odooInvoiceDetailTool,
  odooSaleDetailTool,
  odooPaymentDetailTool,
  odooRepAuditTool,
  odooInvoiceLinkCheckTool,
  odooStockCheckTool,
  odooEmployeeDirectoryTool,
  odooFleetStatusTool,
  odooPreviewQuotationTool,
  odooSaveQuotationTool,
  odooSaveProductTool,
  odooCreateDraftInvoiceTool,
]
