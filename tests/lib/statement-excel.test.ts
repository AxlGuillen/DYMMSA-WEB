/** Account statement Excel (#145): name, window, invoices and totals — never RFC or contact (decision 2026-10-15). */

import { describe, test, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { generateStatementExcel } from '@/lib/excel/statement'
import { statementLines, statementTotals } from '@/lib/customers'
import type { OdooOpenInvoice } from '@/lib/odoo/income'

const inv = (o: Partial<OdooOpenInvoice>): OdooOpenInvoice => ({
  id: 1, moveType: 'out_invoice', folio: 'F1', customer: 'Andritz', customerId: 24, invoiceDate: '2026-09-01',
  dueDate: '2026-10-01', total: 1160, residual: 580.5, currency: 'MXN', paymentState: 'partial', ...o,
})

async function readSheet(blob: Blob) {
  const wb = XLSX.read(new Uint8Array(await blob.arrayBuffer()), { type: 'array', cellNF: true })
  return wb.Sheets['Estado de cuenta']
}

describe('generateStatementExcel', () => {
  const range = { from: null, to: '2026-10-31', filter: 'all' } as const
  const lines = statementLines(
    [inv({ folio: 'F00387' }), inv({ id: 2, folio: 'F00390', dueDate: '2026-10-20', total: 200, residual: 200 })],
    24, range, '2026-10-15',
  )
  const blob = generateStatementExcel({ customerName: 'Andritz', range, today: '2026-10-15', lines, totals: statementTotals(lines) })

  test('encabezado: cliente, periodo en palabras, qué incluye y fecha de corte', async () => {
    const ws = await readSheet(blob)
    expect(ws.A1.v).toBe('Estado de cuenta')
    expect(ws.B2.v).toBe('Andritz')
    expect(ws.B3.v).toBe('Vence hasta el 31/10/2026')
    expect(ws.B4.v).toBe('Vencidas y por vencer')
    expect(ws.B5.v).toBe('15/10/2026')
  })

  test('una fila por factura con estado, días y montos numéricos con signo de pesos', async () => {
    const ws = await readSheet(blob)
    expect(ws.A7.v).toBe('Folio')
    expect([ws.A8.v, ws.C8.v, ws.D8.v, ws.E8.v]).toEqual(['F00387', '01/10/2026', 'Vencida', 'vencida hace 14 días'])
    expect([ws.A9.v, ws.D9.v, ws.E9.v]).toEqual(['F00390', 'Por vencer', 'vence en 5 días'])
    expect(ws.F8.v).toBe(1160)
    expect(ws.G8.v).toBe(580.5)
    expect(ws.G8.z).toBe('"$"#,##0.00')
  })

  test('pie con vencido, por vencer y total por cobrar', async () => {
    const ws = await readSheet(blob)
    expect([ws.E11.v, ws.G11.v]).toEqual(['Vencido', 580.5])
    expect([ws.E12.v, ws.G12.v]).toEqual(['Por vencer', 200])
    expect([ws.E13.v, ws.G13.v]).toEqual(['Total por cobrar', 780.5])
    expect(ws.G13.z).toBe('"$"#,##0.00')
  })

  test('la columna Moneda va en cada fila; otra moneda y una lectura incompleta se avisan en el encabezado', async () => {
    const ws = await readSheet(blob)
    expect([ws.H7.v, ws.H8.v]).toEqual(['Moneda', 'MXN'])

    const flagged = await readSheet(generateStatementExcel({
      customerName: 'Andritz', range, today: '2026-10-15', lines, totals: statementTotals(lines), currencies: ['USD'], truncated: true,
    }))
    expect([flagged.A6.v, flagged.B6.v]).toEqual(['Moneda', expect.stringMatching(/USD sin convertir/)])
    expect([flagged.A7.v, flagged.B7.v]).toEqual(['Aviso', expect.stringMatching(/Puede faltar/)])
    expect(flagged.A9.v).toBe('Folio')
  })

  test('ninguna celda trae RFC, teléfono ni correo', async () => {
    const ws = await readSheet(blob)
    const text = Object.entries(ws).filter(([k]) => !k.startsWith('!')).map(([, c]) => String((c as XLSX.CellObject).v)).join(' ')
    expect(text).not.toMatch(/RFC|Teléfono|Correo|@/)
  })
})
