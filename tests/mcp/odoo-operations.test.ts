/**
 * Tools del bloque Odoo — Fases 3 y 4 (issue #65, ADR-025): inventario del
 * almacén de Odoo, directorio laboral y flotilla. Formas reales capturadas
 * de la instancia (2026-08-11).
 */

import { describe, test, expect } from 'vitest'
import type { OdooCaller } from '@/lib/odoo/client'
import { odooStockCheck, odooEmployeeDirectory, odooFleetStatus } from '@/lib/mcp/tools/odoo/operations'
import { odooQuery } from '@/lib/mcp/tools/odoo/accounting'

type Call = { model: string; method: string; payload: Record<string, unknown> }

function fakeOdoo(script: Record<string, unknown[]>) {
  const calls: Call[] = []
  const pending = Object.fromEntries(Object.entries(script).map(([k, v]) => [k, [...v]]))
  const odoo: OdooCaller = async (model, method, payload) => {
    calls.push({ model, method, payload })
    const key = `${model}.${method}`
    const queue = pending[key]
    if (!queue || queue.length === 0) throw new Error(`sin respuesta programada para ${key}`)
    return queue.shift()
  }
  return { odoo, calls }
}

describe('catálogo fases 3-4', () => {
  test('la nómina queda fuera por diseño: hr.employee no expone campos sensibles', async () => {
    const { odoo } = fakeOdoo({})
    for (const field of ['wage', 'contract_id', 'birthday']) {
      await expect(odooQuery(odoo, { model: 'hr.employee', fields: [field] })).rejects.toThrow(
        /no está en el catálogo/,
      )
    }
  })

  test('qty_available NO es consultable (computado no-almacenado: Odoo revienta al filtrar)', async () => {
    const { odoo } = fakeOdoo({})
    await expect(
      odooQuery(odoo, { model: 'product.product', domain: [['qty_available', '>', 0]] }),
    ).rejects.toThrow(/No se puede filtrar/)
  })
})

describe('odoo_stock_check', () => {
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

    const result = await odooStockCheck(odoo, { producto: 'punta' })

    expect(calls).toHaveLength(1)
    expect(calls[0].payload.domain).toEqual([['product_id', 'ilike', 'punta']])
    // Ordenado por en_mano desc; el display trae el código embebido; los
    // ceros NO se listan (van como conteo en_cero).
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
    const result = await odooStockCheck(odoo, { producto: 'inexistente' })
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
    const result = await odooStockCheck(odoo, { producto: 'producto' })
    expect(result.existencias).toHaveLength(20)
    expect(result.nota).toMatch(/20.*de 25/)
  })
})

describe('odoo_employee_directory', () => {
  test('directorio laboral normalizado (false → null en puesto/teléfono vacíos)', async () => {
    const { odoo } = fakeOdoo({
      'hr.employee.search_read': [[
        {
          id: 1,
          name: 'Diego Baltazar Esquivel',
          job_title: false,
          department_id: [1, 'Administration'],
          work_email: 'x@y.com',
          work_phone: false,
        },
      ]],
    })
    const result = await odooEmployeeDirectory(odoo)
    expect(result.empleados[0]).toEqual({
      nombre: 'Diego Baltazar Esquivel',
      puesto: null,
      departamento: 'Administration',
      correo: 'x@y.com',
      telefono: null,
    })
  })
})

describe('odoo_fleet_status', () => {
  test('vehículos + bitácora; con bitácora vacía lo dice en vez de callar', async () => {
    const { odoo, calls } = fakeOdoo({
      'fleet.vehicle.search_read': [[
        {
          id: 4,
          name: 'Nissan/Frontier/NC-6802-A',
          license_plate: 'NC-6802-A',
          driver_id: [14, 'José Francisco Baltazar Cervantes'],
          odometer: 0.0,
          odometer_unit: 'kilometers',
          model_id: [11, 'Nissan/Frontier'],
          state_id: [1, 'Incompleto'],
        },
      ]],
      'fleet.vehicle.log.services.search_read': [[]],
    })

    const result = await odooFleetStatus(odoo)

    expect(calls).toHaveLength(2)
    expect(result.vehiculos[0]).toMatchObject({
      vehiculo: 'Nissan/Frontier',
      placas: 'NC-6802-A',
      conductor: 'José Francisco Baltazar Cervantes',
      odometro: '0 kilometers',
    })
    expect(result.ultimos_servicios).toEqual([])
    expect(result.nota).toMatch(/bitácora.*vacía/)
  })
})
