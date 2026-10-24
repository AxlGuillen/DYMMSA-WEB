/**
 * The Odoo DYMMSA connector's tools (#155, ADR-041) in tools/list order: the curated reads, the two
 * primitives for the long tail, then the admin-only writes of ADR-040.
 */

import type { ToolDefinition } from '@/lib/mcp/core/define'
import { odooGetDocumentTool } from './accounting/odoo-get-document'
import { odooGetCustomerTool } from './sales/odoo-get-customer'
import { odooListReceivablesTool } from './sales/odoo-list-receivables'
import { odooSummarizeInvoicesTool } from './accounting/odoo-summarize-invoices'
import { odooSummarizeSalesTool } from './sales/odoo-summarize-sales'
import { odooAuditInvoiceLinksTool } from './accounting/odoo-audit-invoice-links'
import { odooAuditPaymentComplementsTool } from './accounting/odoo-audit-payment-complements'
import { odooSearchStockTool } from './operations/odoo-search-stock'
import { odooSearchRecordsTool } from './queries/odoo-search-records'
import { odooAggregateRecordsTool } from './queries/odoo-aggregate-records'
import { odooPreviewQuotationTool } from './quotations/odoo-preview-quotation'
import { odooSaveQuotationTool } from './quotations/odoo-save-quotation'
import { odooSaveProductTool } from './quotations/odoo-save-product'
import { odooCreateDraftInvoiceTool } from './quotations/odoo-create-draft-invoice'

export const ODOO_TOOLS: readonly ToolDefinition[] = [
  odooGetDocumentTool,
  odooGetCustomerTool,
  odooListReceivablesTool,
  odooSummarizeInvoicesTool,
  odooSummarizeSalesTool,
  odooAuditInvoiceLinksTool,
  odooAuditPaymentComplementsTool,
  odooSearchStockTool,
  odooSearchRecordsTool,
  odooAggregateRecordsTool,
  odooPreviewQuotationTool,
  odooSaveQuotationTool,
  odooSaveProductTool,
  odooCreateDraftInvoiceTool,
]
