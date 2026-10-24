/** Odoo block, phases 3 and 4 (#65, ADR-025): Odoo warehouse inventory; the staff directory and
 *  the fleet are read with odoo_search_records since #155. Shapes captured from the real instance. */

import { describe, test, expect } from 'vitest'
import { odooSearchStock } from '@/lib/mcp/tools/odoo/operations'
import { odooSearchRecords } from '@/lib/mcp/tools/odoo/accounting'
import { fakeOdoo } from '../helpers/fake-odoo'

describe('catálogo fases 3-4', () => {
  test('la nómina queda fuera por diseño: hr.employee no expone campos sensibles', async () => {
    const { odoo } = fakeOdoo({})
    for (const field of ['wage', 'contract_id', 'birthday']) {
      await expect(odooSearchRecords(odoo, { modelo: 'hr.employee', campos: [field] })).rejects.toThrow(
        /no está en el catálogo/,
      )
    }
  })

  test('qty_available NO es consultable (computado no-almacenado: Odoo revienta al filtrar)', async () => {
    const { odoo } = fakeOdoo({})
    await expect(
      odooSearchRecords(odoo, { modelo: 'product.product', filtros: [['qty_available', '>', 0]] }),
    ).rejects.toThrow(/No se puede filtrar/)
  })
})

// The retired odoo_employee_directory / odoo_fleet_status were one primitive call each (#155, ADR-041 §12).
describe('directorio y flotilla con odoo_search_records', () => {
  test('el correo de trabajo de una persona y la camioneta que tiene asignada', async () => {
    const { odoo, calls } = fakeOdoo({
      'hr.employee.search_read': [[
        { id: 1, name: 'Diego Baltazar Esquivel', job_title: false, department_id: [1, 'Administration'], work_email: 'x@y.com', work_phone: false },
      ]],
      'fleet.vehicle.search_read': [[
        { id: 4, name: 'Nissan/Frontier/NC-6802-A', license_plate: 'NC-6802-A', driver_id: [14, 'Diego Baltazar Esquivel'], odometer: 0, odometer_unit: 'kilometers', model_id: [11, 'Nissan/Frontier'], state_id: [1, 'Incompleto'] },
      ]],
    })
    const people = await odooSearchRecords(odoo, { modelo: 'hr.employee', filtros: [['name', 'ilike', 'Diego']] })
    expect(people.items[0]).toMatchObject({ name: 'Diego Baltazar Esquivel', work_email: 'x@y.com', job_title: null, department_id: 'Administration' })

    const cars = await odooSearchRecords(odoo, { modelo: 'fleet.vehicle', filtros: [['driver_id', 'ilike', 'Diego']] })
    expect(cars.items[0]).toMatchObject({ license_plate: 'NC-6802-A', driver_id: 'Diego Baltazar Esquivel', model_id: 'Nissan/Frontier' })
    expect(calls.map((c) => c.model)).toEqual(['hr.employee', 'fleet.vehicle'])
  })

  test('la bitácora de servicios de la flotilla también es del catálogo', async () => {
    const { odoo } = fakeOdoo({ 'fleet.vehicle.log.services.search_read': [[]] })
    await expect(odooSearchRecords(odoo, { modelo: 'fleet.vehicle.log.services', orden: 'date desc' })).resolves.toMatchObject({ count: 0, items: [] })
  })
})

describe('odoo_search_stock', () => {
  test('1 llamada: agrupa quants por producto (todas las ubicaciones) y ordena por existencia', async () => {
    const { odoo, calls } = fakeOdoo({
      'stock.quant.read_group': [[
        {
          product_id: [20433, '[510055360] 926 Pinza para electricista SURTEK'],
          product_id_count: 1,
          quantity: 4,
          available_quantity: 4,
          __domain: [],
        },
        {
          product_id: [999, '[510000835] Destornillador sin stock'],
          product_id_count: 1,
          quantity: 0,
          available_quantity: 0,
          __domain: [],
        },
        {
          product_id: [110, '[510023782] Punta de cobre 25 x 300 mm'],
          product_id_count: 2,
          quantity: 12,
          available_quantity: 10,
          __domain: [],
        },
      ]],
    })

    const result = await odooSearchStock(odoo, { producto: 'punta' })

    expect(calls).toHaveLength(1)
    expect(calls[0].payload.domain).toEqual([['product_id', 'ilike', 'punta']])
    // Sorted by on-hand desc; the display carries the embedded code and zeros
    // are not listed (they go as the en_cero count).
    expect(result.existencias[0]).toEqual({
      producto: '[510023782] Punta de cobre 25 x 300 mm',
      en_mano: 12,
      disponible: 10,
    })
    expect(result.existencias).toHaveLength(2)
    expect(result.coincidencias).toBe(3)
    expect(result.en_cero).toBe(1)
  })

  test('sin coincidencias → mensaje claro', async () => {
    const { odoo } = fakeOdoo({ 'stock.quant.read_group': [[]] })
    const result = await odooSearchStock(odoo, { producto: 'inexistente' })
    expect(result.coincidencias).toBe(0)
    expect(result.mensaje).toContain('inexistente')
  })

  test('más de 20 con stock → lista 20 y AVISA el truncado (PR #67: sin caps silenciosos)', async () => {
    const groups = Array.from({ length: 25 }, (_, i) => ({
      product_id: [i + 1, `[C${i}] Producto ${i}`],
      product_id_count: 1,
      quantity: 25 - i,
      available_quantity: 25 - i,
      __domain: [],
    }))
    const { odoo } = fakeOdoo({ 'stock.quant.read_group': [[...groups]] })
    const result = await odooSearchStock(odoo, { producto: 'producto' })
    expect(result.existencias).toHaveLength(20)
    expect(result.nota).toMatch(/20.*de 25/)
  })
})

