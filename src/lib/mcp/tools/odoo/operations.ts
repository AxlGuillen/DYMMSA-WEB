/**
 * Bloque Odoo — Fases 3 y 4: Inventario, Empleados y Flotilla (issue #65,
 * ADR-025). SOLO lectura, mismo contrato que accounting/sales.
 *
 * Inventario: la verdad almacenada es stock.quant (qty_available de
 * product.product es computado no-almacenado: Odoo no puede filtrar/ordenar
 * por él). El display de product_id ya trae el código: "[510023782] Punta…".
 */

import type { OdooCaller } from '@/lib/odoo/client'
import { normalizeGroups, normalizeRecords } from '@/lib/odoo/normalize'
import { ToolError } from '../../shared'

// ── odoo_stock_check (Fase 3) ──────────────────────────────────────────

export async function odooStockCheck(odoo: OdooCaller, input: { producto: string }) {
  const query = input.producto?.trim()
  if (!query) throw new ToolError('Indica el nombre o código del producto a buscar')

  // 1 llamada: agrupar quants por producto suma todas las ubicaciones, y el
  // ilike sobre el many2one busca en el display (código + nombre) a la vez.
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
  // Respuesta digerida: solo lo que SÍ tiene existencia (los ceros van como
  // conteo — 50 renglones de ceros son ruido, no información).
  const conExistencia = todas.filter((e) => e.en_mano > 0)

  return {
    busqueda: query,
    coincidencias: todas.length,
    en_cero: todas.length - conExistencia.length,
    // undefined desaparece al serializar.
    mensaje: todas.length === 0
      ? `Ningún producto con existencias registradas en Odoo coincide con "${query}"`
      : undefined,
    existencias: conExistencia.slice(0, 20),
  }
}

// ── odoo_employee_directory (Fase 4) ───────────────────────────────────

export async function odooEmployeeDirectory(odoo: OdooCaller) {
  const employees = normalizeRecords(
    await odoo('hr.employee', 'search_read', {
      domain: [],
      fields: ['name', 'job_title', 'department_id', 'work_email', 'work_phone'],
      limit: 50,
      order: 'name asc',
    }),
  )
  return {
    empleados: employees.map((e) => ({
      nombre: e.name,
      puesto: e.job_title,
      departamento: e.department_id,
      correo: e.work_email,
      telefono: e.work_phone,
    })),
  }
}

// ── odoo_fleet_status (Fase 4) ─────────────────────────────────────────

export async function odooFleetStatus(odoo: OdooCaller) {
  const vehicles = normalizeRecords(
    await odoo('fleet.vehicle', 'search_read', {
      domain: [],
      fields: ['name', 'license_plate', 'driver_id', 'odometer', 'odometer_unit', 'model_id', 'state_id'],
      limit: 50,
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
