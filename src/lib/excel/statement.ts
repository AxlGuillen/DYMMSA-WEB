import * as XLSX from 'xlsx'
import { formatDay, sanitizeFilename } from '@/lib/format'
import { daysLabel, rangeLabel, STATEMENT_FILTER_LABELS, type StatementLine, type StatementRange, type StatementTotals } from '@/lib/customers'

const MONEY_FORMAT = '"$"#,##0.00'
const day = (iso: string | null) => (iso ? formatDay(iso, 'dd/mm/yyyy') : '')

export interface StatementExport {
  customerName: string
  range: StatementRange
  today: string
  lines: readonly StatementLine[]
  totals: StatementTotals
  /** Non-MXN currencies summed in the totals without conversion (ADR-027 §7). */
  currencies?: readonly string[]
  /** The Odoo read hit its limit: the document must not pass for complete. */
  truncated?: boolean
}

/**
 * The customer's account statement (#145, ADR-039). Name, folios, dates and amounts only: no RFC,
 * address, contact or CFDI UUID ever goes in a document meant to leave the company (decision 2026-10-15).
 */
export function generateStatementExcel({ customerName, range, today, lines, totals, currencies = [], truncated = false }: StatementExport): Blob {
  const header: (string | number)[][] = [
    ['Estado de cuenta'],
    ['Cliente', customerName],
    ['Periodo', rangeLabel(range, day)],
    ['Incluye', STATEMENT_FILTER_LABELS[range.filter]],
    ['Fecha de corte', day(today)],
    ...(currencies.length ? [['Moneda', `Montos en su moneda original; los totales incluyen ${currencies.join(', ')} sin convertir`]] : []),
    ...(truncated ? [['Aviso', 'Puede faltar alguna factura: Odoo devolvió el máximo de registros']] : []),
    [],
    ['Folio', 'Fecha de factura', 'Vencimiento', 'Estado', 'Días', 'Total', 'Saldo', 'Moneda'],
  ]
  const firstLine = header.length
  const body = lines.map((l) => [
    l.folio,
    day(l.invoiceDate),
    day(l.dueDate),
    l.status === 'overdue' ? 'Vencida' : 'Por vencer',
    daysLabel(l),
    l.total,
    l.residual,
    l.currency ?? '',
  ])
  const footer: (string | number)[][] = [
    [],
    ['', '', '', '', 'Vencido', '', totals.overdue],
    ['', '', '', '', 'Por vencer', '', totals.upcoming],
    ['', '', '', '', 'Total por cobrar', '', totals.total],
  ]
  const data = [...header, ...body, ...footer]
  const worksheet = XLSX.utils.aoa_to_sheet(data)

  // Amounts stay numbers Excel can add, shown with the peso sign (Total and Saldo columns).
  for (let r = firstLine; r < data.length; r++) {
    for (const c of [5, 6]) {
      const cell = worksheet[XLSX.utils.encode_cell({ r, c })]
      if (cell && cell.t === 'n') cell.z = MONEY_FORMAT
    }
  }
  worksheet['!cols'] = [{ wch: 18 }, { wch: 16 }, { wch: 14 }, { wch: 12 }, { wch: 24 }, { wch: 14 }, { wch: 14 }, { wch: 8 }]

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Estado de cuenta')
  const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' })
  return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

export function downloadStatementExcel(blob: Blob, customerName: string, today: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `estado_de_cuenta_${sanitizeFilename(customerName)}_${today}.xlsx`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
