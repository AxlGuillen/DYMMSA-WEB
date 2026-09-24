/** MCP suppliers tool + the name lookup the payables writes reuse (#109). */

import { describe, test, expect } from 'vitest'
import { createMockSupabase, hasFilter } from '../helpers/supabase-mock'
import { type Db } from '@/lib/mcp/shared'
import { listSuppliers, resolveSupplier } from '@/lib/mcp/tools/suppliers'

const asDb = (c: ReturnType<typeof createMockSupabase>) => c as unknown as Db

const supplier = (id: string, name: string, terms: number | null, brands: string[]) => ({
  id, name, phone: null, whatsapp: null, email: null, address: null, notes: null, payment_terms_days: terms,
  created_at: '', updated_at: '',
  supplier_brands: brands.map((b) => ({ brands: { name: b } })),
})

describe('listSuppliers', () => {
  test('aplana marcas, traduce el plazo y filtra por marca en JS', async () => {
    const client = createMockSupabase({
      responses: {
        suppliers: { data: [supplier('s1', 'Perfiles del Bajío', 30, ['SURTEK', 'FOY']), supplier('s2', 'Tornillos MX', null, [])] },
      },
    })
    const all = await listSuppliers(asDb(client), {})
    expect(all.total).toBe(2)
    expect(all.proveedores[0]).toMatchObject({ nombre: 'Perfiles del Bajío', plazo_pago: '1 mes', marcas: ['FOY', 'SURTEK'] })
    expect(all.proveedores[1]).toMatchObject({ plazo_pago: 'Contado', dias_credito: null })

    const surtek = await listSuppliers(asDb(client), { marca: 'surtek' })
    expect(surtek.proveedores.map((s) => s.nombre)).toEqual(['Perfiles del Bajío'])
    expect(surtek).toMatchObject({ total: 1, mostrados: 1 })
    // With a brand the SQL limit is wide: the cut happens after filtering (review PR #111).
    expect(client.callsTo('suppliers', 'select')[1].filters.find((f) => f.method === 'limit')?.args[0]).toBe(1000)
    expect(client.callsTo('suppliers', 'select')[0].filters.find((f) => f.method === 'limit')?.args[0]).toBe(50)
  })

  test('buscar aplica el or sobre nombre/teléfono/email', async () => {
    const client = createMockSupabase({ responses: { suppliers: { data: [] } } })
    await listSuppliers(asDb(client), { buscar: 'perfiles' })
    expect(hasFilter(client.callsTo('suppliers', 'select')[0], 'name.ilike.%perfiles%,phone.ilike.%perfiles%,whatsapp.ilike.%perfiles%,email.ilike.%perfiles%', 'or')).toBe(true)
  })
})

describe('resolveSupplier', () => {
  test('una coincidencia la devuelve; ninguna o varias → error que guía', async () => {
    const one = createMockSupabase({ responses: { suppliers: { data: [{ id: 's1', name: 'Perfiles del Bajío', payment_terms_days: 30 }] } } })
    expect(await resolveSupplier(asDb(one), 'perfiles')).toMatchObject({ id: 's1' })

    const none = createMockSupabase({ responses: { suppliers: { data: [] } } })
    await expect(resolveSupplier(asDb(none), 'zzz')).rejects.toThrow(/No hay proveedor que coincida con "zzz"/)

    const many = createMockSupabase({
      responses: { suppliers: { data: [{ id: 's1', name: 'Perfiles A', payment_terms_days: 0 }, { id: 's2', name: 'Perfiles B', payment_terms_days: 0 }] } },
    })
    await expect(resolveSupplier(asDb(many), 'perfiles')).rejects.toThrow(/2 coincidencias \(Perfiles A, Perfiles B\)/)
    await expect(resolveSupplier(asDb(many), '  ')).rejects.toThrow(/Indica el nombre/)
  })
})
