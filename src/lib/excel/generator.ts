import * as XLSX from 'xlsx'
import type { EtmProduct } from '@/types/database'

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
