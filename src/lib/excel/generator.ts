import * as XLSX from 'xlsx'
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

/**
 * Genera un archivo Excel de pedido URREA
 * Solo incluye productos con quantity_to_order > 0
 * Columnas: model_code | quantity
 */
export function generateUrreaOrderExcel(items: OrderItem[]): Blob {
  const workbook = XLSX.utils.book_new()

  // Filter items that need to be ordered
  const itemsToOrder = items.filter((item) => item.quantity_to_order > 0)

  // Prepare data with headers
  const data = [
    ['MODEL_CODE', 'QUANTITY'],
    ...itemsToOrder.map((item) => [item.model_code, item.quantity_to_order]),
  ]

  // Create worksheet
  const worksheet = XLSX.utils.aoa_to_sheet(data)

  // Set column widths
  worksheet['!cols'] = [
    { wch: 20 }, // MODEL_CODE
    { wch: 12 }, // QUANTITY
  ]

  XLSX.utils.book_append_sheet(workbook, worksheet, 'Pedido URREA')

  // Generate binary buffer
  const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' })
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

/**
 * Descarga el Excel de pedido URREA
 */
export function downloadUrreaOrder(blob: Blob, customerName: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url

  // Generate filename: pedido_urrea_<customer>_<date>.xlsx
  const date = new Date().toISOString().split('T')[0]
  const safeName = customerName.replace(/[^a-z0-9]/gi, '_').toLowerCase()
  link.download = `pedido_urrea_${safeName}_${date}.xlsx`

  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
