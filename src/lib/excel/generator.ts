import * as XLSX from 'xlsx'
import type { EtmProduct } from '@/types/database'

/**
 * Genera un archivo Excel de cotizacion con los productos encontrados
 */
export function generateQuoteExcel(products: EtmProduct[]): Blob {
  const workbook = XLSX.utils.book_new()

  // Preparar datos con headers
  const data = [
    ['ETM', 'Descripcion', 'Modelo', 'Precio', 'Marca'],
    ...products.map((p) => [
      p.etm,
      p.descripcion || p.description,
      p.modelo,
      p.precio,
      p.marca,
    ]),
  ]

  // Agregar fila de totales
  const total = products.reduce((sum, p) => sum + (p.precio || 0), 0)
  data.push([])
  data.push(['', '', 'TOTAL:', total, ''])

  // Crear worksheet
  const worksheet = XLSX.utils.aoa_to_sheet(data)

  // Configurar anchos de columna
  worksheet['!cols'] = [
    { wch: 15 }, // ETM
    { wch: 45 }, // Descripcion
    { wch: 15 }, // Modelo
    { wch: 12 }, // Precio
    { wch: 10 }, // Marca
  ]

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
