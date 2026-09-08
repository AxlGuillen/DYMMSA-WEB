import * as XLSX from 'xlsx'
import JSZip from 'jszip'
import { sanitizeFilename, formatISODate } from '@/lib/format'
import { receivedForCustomer } from '@/lib/business-rules'
import type { EtmProduct, OrderItem } from '@/types/database'

export function generateQuoteExcel(products: EtmProduct[]): Blob {
  const workbook = XLSX.utils.book_new()

  const data = [
    ['ETM', 'Description', 'Descripcion', 'Modelo', 'Precio', 'Marca'],
    ...products.map((p) => [
      p.etm,
      p.description,
      p.description_es,
      p.model_code,
      p.price,
      p.brand,
    ]),
  ]

  const total = products.reduce((sum, p) => sum + (p.price || 0), 0)
  data.push([])
  data.push(['', '', '', 'TOTAL:', total, ''])

  const worksheet = XLSX.utils.aoa_to_sheet(data)

  worksheet["!cols"] = [
    { wch: 15 }, // ETM
    { wch: 35 }, // Description
    { wch: 35 }, // Description_es
    { wch: 15 }, // Model_code
    { wch: 12 }, // Price
    { wch: 10 }, // Brand
  ];

  XLSX.utils.book_append_sheet(workbook, worksheet, 'Cotizacion')

  const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' })
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

export function downloadExcel(blob: Blob, originalFilename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url

  const baseName = originalFilename.replace(/\.[^/.]+$/, '')
  link.download = `${baseName}_cotizacion.xlsx`

  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

// URREA order template: driven through JSZip so the VBA macros survive.

const SPREADSHEET_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const RELS_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

async function findSheetPath(zip: JSZip, sheetName: string): Promise<string> {
  const parser = new DOMParser()

  const wbXml = await zip.file('xl/workbook.xml')?.async('string')
  if (!wbXml) throw new Error('workbook.xml not found in template')
  const wbDoc = parser.parseFromString(wbXml, 'application/xml')

  const sheets = wbDoc.getElementsByTagNameNS(SPREADSHEET_NS, 'sheet')
  let rId = ''
  for (let i = 0; i < sheets.length; i++) {
    if (sheets[i].getAttribute('name') === sheetName) {
      rId = sheets[i].getAttributeNS(RELS_NS, 'id') || ''
      break
    }
  }
  if (!rId) throw new Error(`Hoja "${sheetName}" no encontrada en el template`)

  const relsXml = await zip.file('xl/_rels/workbook.xml.rels')?.async('string')
  if (!relsXml) throw new Error('workbook.xml.rels not found in template')
  const relsDoc = parser.parseFromString(relsXml, 'application/xml')

  const rels = relsDoc.getElementsByTagName('Relationship')
  for (let i = 0; i < rels.length; i++) {
    if (rels[i].getAttribute('Id') === rId) {
      const target = rels[i].getAttribute('Target') || ''
      return `xl/${target}`
    }
  }

  throw new Error(`Relationship ${rId} not found in template`)
}

function colLetterToIndex(col: string): number {
  let index = 0
  for (let i = 0; i < col.length; i++) {
    index = index * 26 + (col.charCodeAt(i) - 64)
  }
  return index
}

/** Writes one cell into the XML, leaving the rest of the row (and its formulas) intact. */
function setCellValue(doc: Document, sheetData: Element, ref: string, value: string | number) {
  const rowNum = parseInt(ref.replace(/[A-Z]+/, ''))
  const colLetter = ref.replace(/[0-9]+/, '')

  const rows = sheetData.getElementsByTagNameNS(SPREADSHEET_NS, 'row')
  let rowEl: Element | null = null
  for (let i = 0; i < rows.length; i++) {
    if (parseInt(rows[i].getAttribute('r') || '0') === rowNum) {
      rowEl = rows[i]
      break
    }
  }

  if (!rowEl) {
    rowEl = doc.createElementNS(SPREADSHEET_NS, 'row')
    rowEl.setAttribute('r', String(rowNum))
    let inserted = false
    for (let i = 0; i < rows.length; i++) {
      if (parseInt(rows[i].getAttribute('r') || '0') > rowNum) {
        sheetData.insertBefore(rowEl, rows[i])
        inserted = true
        break
      }
    }
    if (!inserted) sheetData.appendChild(rowEl)
  }

  const cells = rowEl.getElementsByTagNameNS(SPREADSHEET_NS, 'c')
  let cellEl: Element | null = null
  for (let i = 0; i < cells.length; i++) {
    if (cells[i].getAttribute('r') === ref) {
      cellEl = cells[i]
      break
    }
  }

  if (!cellEl) {
    cellEl = doc.createElementNS(SPREADSHEET_NS, 'c')
    cellEl.setAttribute('r', ref)
    // Insert in column order: out-of-order cells are invalid XML
    const colIndex = colLetterToIndex(colLetter)
    let inserted = false
    for (let i = 0; i < cells.length; i++) {
      const existingCol = cells[i].getAttribute('r')!.replace(/[0-9]+/, '')
      if (colLetterToIndex(existingCol) > colIndex) {
        rowEl.insertBefore(cellEl, cells[i])
        inserted = true
        break
      }
    }
    if (!inserted) rowEl.appendChild(cellEl)
  }

  while (cellEl.firstChild) cellEl.removeChild(cellEl.firstChild)

  if (typeof value === 'string') {
    cellEl.setAttribute('t', 'inlineStr')
    const is = doc.createElementNS(SPREADSHEET_NS, 'is')
    const t = doc.createElementNS(SPREADSHEET_NS, 't')
    t.textContent = value
    is.appendChild(t)
    cellEl.appendChild(is)
  } else {
    cellEl.removeAttribute('t')
    const v = doc.createElementNS(SPREADSHEET_NS, 'v')
    v.textContent = String(value)
    cellEl.appendChild(v)
  }
}

/** URREA order row: catalog code + PIECES (a multiple of STD, ADR-018). */
export interface UrreaOrderRow {
  code: string
  pieces: number
}

// The template pre-loads formulas up to row 1026; starting at 15 that leaves 1012 usable rows.
const URREA_TEMPLATE_START_ROW = 15
const URREA_TEMPLATE_MAX_ROWS = 1012

/** Only fills A/B of the FORMATO sheet; the rows arrive already decided by the planner. */
export async function generateUrreaOrderExcel(rows: UrreaOrderRow[]): Promise<Blob> {
  if (rows.length > URREA_TEMPLATE_MAX_ROWS) {
    throw new Error(
      `El pedido tiene ${rows.length} filas y el template URREA solo admite ${URREA_TEMPLATE_MAX_ROWS}`,
    )
  }

  const response = await fetch('/formato-pedido-urrea.xlsm')
  if (!response.ok) {
    throw new Error('No se pudo cargar el template de pedido URREA')
  }
  const templateBuffer = await response.arrayBuffer()

  const zip = await JSZip.loadAsync(templateBuffer)

  const sheetPath = await findSheetPath(zip, 'FORMATO')

  const sheetXml = await zip.file(sheetPath)?.async('string')
  if (!sheetXml) throw new Error(`No se pudo leer ${sheetPath} del template`)

  const parser = new DOMParser()
  const doc = parser.parseFromString(sheetXml, 'application/xml')

  const sheetData = doc.getElementsByTagNameNS(SPREADSHEET_NS, 'sheetData')[0]
  if (!sheetData) throw new Error('No se encontró sheetData en la hoja FORMATO')

  // Column A = CÓDIGO O CLAVE, column B = CANTIDAD
  rows.forEach((item, index) => {
    const row = URREA_TEMPLATE_START_ROW + index
    setCellValue(doc, sheetData, `A${row}`, item.code)
    setCellValue(doc, sheetData, `B${row}`, item.pieces)
  })

  const serializer = new XMLSerializer()
  const modifiedXml = serializer.serializeToString(doc)
  zip.file(sheetPath, modifiedXml)

  return zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.ms-excel.sheet.macroEnabled.12',
  })
}

const IVA_RATE = 0.16

/** Delivered = stock + min(received, ordered); the excess is never delivered (ADR-019). */
export function generateDeliveryExcel(items: OrderItem[], _customerName: string): Blob {
  const deliveredItems = items.filter(
    (item) => item.quantity_in_stock + receivedForCustomer(item) > 0
  )

  const headers = [
    'ETM',
    'CANTIDAD',
    'Descripcion',
    'Translate',
    'DYMMSA',
    'Precio',
    'Total',
    'Comments',
    'Comments2',
  ]

  const dataRows = deliveredItems.map((item) => {
    const qty = item.quantity_in_stock + receivedForCustomer(item)
    return [
      item.etm,
      qty,
      '', // description_es not stored in order_items
      item.description,
      item.model_code,
      item.unit_price,
      qty * item.unit_price,
      '',
      '',
    ]
  })

  const subtotal = deliveredItems.reduce((sum, item) => {
    const qty = item.quantity_in_stock + receivedForCustomer(item)
    return sum + qty * item.unit_price
  }, 0)
  const iva = subtotal * IVA_RATE
  const total = subtotal + iva

  const data: (string | number)[][] = [
    headers,
    ...dataRows,
    [],
    ['', '', '', '', '', 'Subtotal:', subtotal, '', ''],
    ['', '', '', '', '', `IVA (${IVA_RATE * 100}%):`, iva, '', ''],
    ['', '', '', '', '', 'Total:', total, '', ''],
  ]

  const worksheet = XLSX.utils.aoa_to_sheet(data)

  worksheet['!cols'] = [
    { wch: 14 }, // ETM
    { wch: 10 }, // CANTIDAD
    { wch: 35 }, // Descripcion
    { wch: 35 }, // Translate
    { wch: 14 }, // DYMMSA
    { wch: 12 }, // Precio
    { wch: 12 }, // Total
    { wch: 18 }, // Comments
    { wch: 18 }, // Comments2
  ]

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Entrega')

  const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' })
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

export function downloadDeliveryExcel(blob: Blob, customerName: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url

  const date = formatISODate()
  const safeName = sanitizeFilename(customerName)
  link.download = `entrega_${safeName}_${date}.xlsx`

  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

// Cut material order (DYMMSA tubes and plates, #59).

/** Supplier order row: the NET need per measure (moment 1). */
export interface CutRequestRow {
  material: string
  measure: string
  pieces: number
  /** "1.28 m" (tubes) or "300 mm de tira de 200 mm" / "área 0.13 m²" (plates). */
  request: string
}

/** Raw material order: one row per measure, from the net need (ADR-022). */
export function generateCutRequestExcel(rows: CutRequestRow[]): Blob {
  const data: (string | number)[][] = [
    ['Material', 'Medida', 'Piezas', 'A pedir'],
    ...rows.map((row) => [row.material, row.measure, row.pieces, row.request]),
  ]

  const worksheet = XLSX.utils.aoa_to_sheet(data)
  worksheet['!cols'] = [
    { wch: 14 }, // Material
    { wch: 26 }, // Medida
    { wch: 8 },  // Piezas
    { wch: 30 }, // A pedir
  ]

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Pedido corte')

  const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' })
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

export function downloadCutRequestExcel(blob: Blob, customerName: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url

  const date = formatISODate()
  const safeName = sanitizeFilename(customerName)
  link.download = `pedido_corte_${safeName}_${date}.xlsx`

  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

// Local retail purchase list (ADR-018).

/** Local purchase row: retail remainders + products missing from the catalog. */
export interface LocalPurchaseRow {
  code: string
  brand: string
  description: string
  etm: string
  quantity: number
  /** Reference sale price (a proxy — NOT the supplier cost). */
  unitPrice: number | null
  /** 'resto menudeo' (planner decision) or 'sin catálogo'. */
  origin: string
}

/** What the planner sent to retail + everything absent from the URREA catalog. */
export function generateLocalPurchaseExcel(rows: LocalPurchaseRow[]): Blob {
  const headers = ['Código', 'Marca', 'Descripción', 'ETM', 'Cantidad', 'Precio venta', 'Origen']

  const data: (string | number)[][] = [
    headers,
    ...rows.map((row) => [
      row.code,
      row.brand,
      row.description,
      row.etm,
      row.quantity,
      row.unitPrice ?? '',
      row.origin,
    ]),
  ]

  const worksheet = XLSX.utils.aoa_to_sheet(data)

  worksheet['!cols'] = [
    { wch: 16 }, // Código
    { wch: 10 }, // Marca
    { wch: 40 }, // Descripción
    { wch: 14 }, // ETM
    { wch: 10 }, // Cantidad
    { wch: 12 }, // Precio venta
    { wch: 16 }, // Origen
  ]

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Compra local')

  const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' })
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

export function downloadLocalPurchaseExcel(blob: Blob, customerName: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url

  const date = formatISODate()
  const safeName = sanitizeFilename(customerName)
  link.download = `compra_local_${safeName}_${date}.xlsx`

  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

export function downloadUrreaOrder(blob: Blob, customerName: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url

  const date = formatISODate()
  const safeName = sanitizeFilename(customerName)
  link.download = `pedido_urrea_${safeName}_${date}.xlsm`

  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
