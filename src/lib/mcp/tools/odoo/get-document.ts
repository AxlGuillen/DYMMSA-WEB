/** One document by folio (#155, ADR-041): the three detail readers behind one tool, picked by prefix or by `tipo`. */

import type { OdooCaller } from '@/lib/odoo/client'
import { documentTypeOf, odooInvoiceDetail, odooSaleDetail, type DocumentType } from './documents'
import { odooPaymentDetail } from './payments'

export interface GetDocumentInput {
  folio: string
  /** Forces the model when the prefix would pick the wrong one. */
  tipo?: DocumentType
}

export async function odooGetDocument(odoo: OdooCaller, input: GetDocumentInput) {
  const tipo = input.tipo ?? documentTypeOf(input.folio)
  if (tipo === 'venta') return { tipo, ...(await odooSaleDetail(odoo, input)) }
  if (tipo === 'pago') return { tipo, ...(await odooPaymentDetail(odoo, input)) }
  return { tipo, ...(await odooInvoiceDetail(odoo, input)) }
}
