/** Odoo phases 3-4 (ADR-025), read-only. Stock truth is stock.quant — qty_available is computed, not stored. */

import type { OdooCaller } from '@/lib/odoo/client'
import { normalizeGroups, normalizeRecords } from '@/lib/odoo/normalize'
import { ToolError } from '../../shared'

const STOCK_LIST_LIMIT = 20
const DIRECTORY_LIMIT = 50

/** No silent truncation (block rule): filling the limit is reported back. */
const truncationNote = (shown: number, limit: number, what: string) =>
  shown === limit ? `Se devolvió el máximo (${limit}) de ${what} — puede haber más.` : undefined

export async function odooStockCheck(odoo: OdooCaller, input: { producto: string }) {
  const query = input.producto?.trim()
  if (!query) throw new ToolError('Indica el nombre o código del producto a buscar')

  // 1 call: grouping quants by product sums every location, and ilike on the many2one
  // searches the display name (code + name) at once.
  const groups = normalizeGroups(
    await odoo('stock.quant', 'read_group', {
      domain: [['product_id', 'ilike', query]],
      fields: ['quantity:sum', 'available_quantity:sum'],
      groupby: ['product_id'],
    }),
  )

  const todas = groups
    .map((g) => ({
      producto: (g.product_id as string | null) ?? '—',
      en_mano: (g.quantity as number) ?? 0,
      disponible: (g.available_quantity as number) ?? 0,
    }))
    .sort((a, b) => b.en_mano - a.en_mano)
  // Only rows with stock; zeros go as a count — 50 zero rows are noise, not information.
  const conExistencia = todas.filter((e) => e.en_mano > 0)

  return {
    busqueda: query,
    coincidencias: todas.length,
    en_cero: todas.length - conExistencia.length,
    // undefined disappears on serialize.
    mensaje: todas.length === 0
      ? `Ningún producto con existencias registradas en Odoo coincide con "${query}"`
      : undefined,
    nota: conExistencia.length > STOCK_LIST_LIMIT
      ? `Se listan las ${STOCK_LIST_LIMIT} con más existencia de ${conExistencia.length} con stock — afina la búsqueda para ver el resto.`
      : undefined,
    existencias: conExistencia.slice(0, STOCK_LIST_LIMIT),
  }
}

export async function odooEmployeeDirectory(odoo: OdooCaller) {
  const employees = normalizeRecords(
    await odoo('hr.employee', 'search_read', {
      domain: [],
      fields: ['name', 'job_title', 'department_id', 'work_email', 'work_phone'],
      limit: DIRECTORY_LIMIT,
      order: 'name asc',
    }),
  )
  return {
    nota: truncationNote(employees.length, DIRECTORY_LIMIT, 'empleados'),
    empleados: employees.map((e) => ({
      nombre: e.name,
      puesto: e.job_title,
      departamento: e.department_id,
      correo: e.work_email,
      telefono: e.work_phone,
    })),
  }
}

export async function odooFleetStatus(odoo: OdooCaller) {
  const vehicles = normalizeRecords(
    await odoo('fleet.vehicle', 'search_read', {
      domain: [],
      fields: ['name', 'license_plate', 'driver_id', 'odometer', 'odometer_unit', 'model_id', 'state_id'],
      limit: DIRECTORY_LIMIT,
      order: 'name asc',
    }),
  )
  const services = normalizeRecords(
    await odoo('fleet.vehicle.log.services', 'search_read', {
      domain: [],
      fields: ['vehicle_id', 'service_type_id', 'date', 'amount', 'state', 'description'],
      limit: 10,
      order: 'date desc',
    }),
  )

  return {
    nota_vehiculos: truncationNote(vehicles.length, DIRECTORY_LIMIT, 'vehículos'),
    vehiculos: vehicles.map((v) => ({
      vehiculo: v.model_id ?? v.name,
      placas: v.license_plate,
      conductor: v.driver_id,
      odometro: typeof v.odometer === 'number' ? `${v.odometer} ${v.odometer_unit ?? ''}`.trim() : null,
      estado: v.state_id,
    })),
    ultimos_servicios: services.map((s) => ({
      vehiculo: s.vehicle_id,
      servicio: s.service_type_id,
      fecha: s.date,
      costo: s.amount,
      estado: s.state,
      descripcion: s.description,
    })),
    nota: services.length === 0
      ? 'La bitácora de servicios está vacía en Odoo — aún no registran mantenimientos.'
      : undefined,
  }
}
