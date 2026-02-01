import * as XLSX from 'xlsx'
import JSZip from 'jszip'
import type { EtmProduct, OrderItem } from '@/types/database'

/**
 * Genera un archivo Excel de cotizacion con los productos encontrados
 */
export function generateQuoteExcel(products: EtmProduct[]): Blob {
  const workbook = XLSX.utils.book_new()

  // Preparar datos con headers
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

  // Agregar fila de totales
  const total = products.reduce((sum, p) => sum + (p.price || 0), 0)
  data.push([])
  data.push(['', '', '', 'TOTAL:', total, ''])

  // Crear worksheet
  const worksheet = XLSX.utils.aoa_to_sheet(data)

  // Configurar anchos de columna
  worksheet["!cols"] = [
    { wch: 15 }, // ETM
    { wch: 35 }, // Description
    { wch: 35 }, // Description_es
    { wch: 15 }, // Model_code
    { wch: 12 }, // Price
    { wch: 10 }, // Brand
  ];

  XLSX.utils.book_append_sheet(workbook, worksheet, 'Cotizacion')

  // Generar buffer binario
  const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' })
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

/**
 * Descarga un Blob como archivo Excel
 */
export function downloadExcel(blob: Blob, originalFilename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url

  // Generar nombre de archivo: original_cotizacion.xlsx
  const baseName = originalFilename.replace(/\.[^/.]+$/, '')
  link.download = `${baseName}_cotizacion.xlsx`

  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

// --- URREA Order Template (JSZip-based to preserve VBA macros) ---

const SPREADSHEET_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const RELS_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

/**
 * Finds the worksheet XML file path inside the .xlsm ZIP for a given sheet name
 */
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

/**
 * Sets a cell value in the worksheet XML DOM.
 * Strings use inline string format, numbers use value format.
 * Preserves existing cells (formulas) in the same row.
 */
function setCellValue(doc: Document, sheetData: Element, ref: string, value: string | number) {
  const rowNum = parseInt(ref.replace(/[A-Z]+/, ''))
  const colLetter = ref.replace(/[0-9]+/, '')

  // Find the row
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

  // Find or create the cell
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
    // Insert in column order to maintain valid XML
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

  // Clear existing content
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

/**
 * Genera un archivo Excel de pedido URREA usando el template .xlsm
 * Manipula el ZIP directamente para preservar macros VBA y formulas intactas.
 * Solo rellena columnas A (CÓDIGO) y B (CANTIDAD) en la hoja FORMATO.
 */
export async function generateUrreaOrderExcel(items: OrderItem[]): Promise<Blob> {
  const itemsToOrder = items.filter((item) => item.quantity_to_order > 0)

  const response = await fetch('/formato-pedido-urrea.xlsm')
  if (!response.ok) {
    throw new Error('No se pudo cargar el template de pedido URREA')
  }
  const templateBuffer = await response.arrayBuffer()

  const zip = await JSZip.loadAsync(templateBuffer)

  // Find the worksheet XML path for FORMATO sheet
  const sheetPath = await findSheetPath(zip, 'FORMATO')

  const sheetXml = await zip.file(sheetPath)?.async('string')
  if (!sheetXml) throw new Error(`No se pudo leer ${sheetPath} del template`)

  const parser = new DOMParser()
  const doc = parser.parseFromString(sheetXml, 'application/xml')

  const sheetData = doc.getElementsByTagNameNS(SPREADSHEET_NS, 'sheetData')[0]
  if (!sheetData) throw new Error('No se encontró sheetData en la hoja FORMATO')

  // Fill column A (CÓDIGO O CLAVE) and column B (CANTIDAD) starting at row 15
  const startRow = 15
  itemsToOrder.forEach((item, index) => {
    const row = startRow + index
    setCellValue(doc, sheetData, `A${row}`, item.model_code)
    setCellValue(doc, sheetData, `B${row}`, item.quantity_to_order)
  })

  // Serialize modified XML back and replace in ZIP
  const serializer = new XMLSerializer()
  const modifiedXml = serializer.serializeToString(doc)
  zip.file(sheetPath, modifiedXml)

  return zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.ms-excel.sheet.macroEnabled.12',
  })
}

/**
 * Descarga el Excel de pedido URREA
 */
export function downloadUrreaOrder(blob: Blob, customerName: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url

  const date = new Date().toISOString().split('T')[0]
  const safeName = customerName.replace(/[^a-z0-9]/gi, '_').toLowerCase()
  link.download = `pedido_urrea_${safeName}_${date}.xlsm`

  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
