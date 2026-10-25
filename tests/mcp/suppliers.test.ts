/** MCP suppliers tool + the name lookup the payables writes reuse (#109). */

import { describe, test, expect } from 'vitest'
import { createMockSupabase, filterValue, hasFilter, type CallRecord } from '../helpers/supabase-mock'
import type { Db } from '@/lib/mcp/core/db'
import { listSuppliers, resolveSupplier, saveSupplier } from '@/lib/mcp/tools/suppliers'
import { createSupplier } from '@/lib/suppliers-store'

const S1 = '5a1b2c3d-0000-4000-8000-000000000001'
const S2 = '6b2c3d4e-0000-4000-8000-000000000002'

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
        suppliers: { data: [supplier(S1, 'Perfiles del Bajío', 30, ['SURTEK', 'FOY']), supplier(S2, 'Tornillos MX', null, [])] },
      },
    })
    const all = await listSuppliers(asDb(client), {})
    expect(all.total).toBe(2)
    expect(all.proveedores[0]).toMatchObject({ ref: '5a1b2c3d', nombre: 'Perfiles del Bajío', plazo_pago: '1 mes', marcas: ['FOY', 'SURTEK'] })
    expect(all.proveedores[1]).toMatchObject({ plazo_pago: 'Contado', dias_credito: null })

    const surtek = await listSuppliers(asDb(client), { marca: 'surtek' })
    expect(surtek.proveedores.map((s) => s.nombre)).toEqual(['Perfiles del Bajío'])
    expect(surtek).toMatchObject({ total: 1, pagina: 1, hay_mas: false })
    // With a brand the SQL limit is wide: the cut happens after filtering (review PR #111).
    expect(client.callsTo('suppliers', 'select')[1].filters.find((f) => f.method === 'limit')?.args[0]).toBe(1000)
    expect(client.callsTo('suppliers', 'select')[0].filters.find((f) => f.method === 'range')?.args).toEqual([0, 49])
  })

  test('buscar aplica el or sobre nombre/teléfono/email', async () => {
    const client = createMockSupabase({ responses: { suppliers: { data: [] } } })
    await listSuppliers(asDb(client), { buscar: 'perfiles' })
    expect(hasFilter(client.callsTo('suppliers', 'select')[0], 'name.ilike.%perfiles%,phone.ilike.%perfiles%,whatsapp.ilike.%perfiles%,email.ilike.%perfiles%', 'or')).toBe(true)
  })
})

describe('resolveSupplier', () => {
  test('una coincidencia la devuelve; ninguna o varias → error que guía', async () => {
    const one = createMockSupabase({ responses: { suppliers: { data: [{ id: S1, name: 'Perfiles del Bajío', payment_terms_days: 30 }] } } })
    expect(await resolveSupplier(asDb(one), 'perfiles')).toMatchObject({ id: S1 })

    const none = createMockSupabase({ responses: { suppliers: { data: [] } } })
    await expect(resolveSupplier(asDb(none), 'zzz')).rejects.toThrow(/No hay proveedor que coincida con "zzz"/)

    const many = createMockSupabase({
      responses: { suppliers: { data: [{ id: S1, name: 'Perfiles A', payment_terms_days: 0 }, { id: S2, name: 'Perfiles B', payment_terms_days: 0 }] } },
    })
    await expect(resolveSupplier(asDb(many), 'perfiles')).rejects.toThrow(/2 coincidencias \(Perfiles A \[ref 5a1b2c3d\], Perfiles B \[ref 6b2c3d4e\]\)/)
    await expect(resolveSupplier(asDb(many), '  ')).rejects.toThrow(/Indica el proveedor/)
  })
})

describe('saveSupplier (#134)', () => {
  const BRANDS = { data: [{ id: 'b-foy', name: 'FOY' }, { id: 'b-surtek', name: 'SURTEK' }], error: null }
  const saved = supplier(S1, 'Tornillos MX', 30, ['SURTEK'])
  // resolveSupplier reads a list; reading the saved row back is a .single().
  const suppliersSelect = (rec: CallRecord) =>
    rec.single ? { data: saved, error: null } : { data: [{ id: S1, name: 'Tornillos MX', payment_terms_days: 30 }], error: null }

  test('alta: mismos defaults que la app, marcas por nombre normalizado y devuelve el proveedor guardado', async () => {
    const client = createMockSupabase({
      responses: {
        brands: BRANDS,
        'suppliers.insert': { data: { ...saved }, error: null },
        'suppliers.select': suppliersSelect,
        'supplier_brands.insert': { data: null, error: null },
      },
    })
    const result = await saveSupplier(asDb(client), { nombre: '  Tornillos MX ', dias_credito: 30, agregar_marcas: [' surtek '] })
    expect(client.insertPayload('suppliers')).toEqual({
      name: 'Tornillos MX', phone: null, whatsapp: null, email: null, address: null, notes: null, payment_terms_days: 30,
    })
    expect(client.insertPayload('supplier_brands')).toEqual([{ supplier_id: S1, brand_id: 'b-surtek' }])
    expect(result).toMatchObject({ accion: 'creado', escrito: true, proveedor: { nombre: 'Tornillos MX', dias_credito: 30, marcas: ['SURTEK'] } })
  })

  test('REGLA: una marca que no existe no se crea: error con el catálogo y nada escrito', async () => {
    const client = createMockSupabase({ responses: { brands: BRANDS } })
    await expect(saveSupplier(asDb(client), { nombre: 'Nuevo', agregar_marcas: ['SURTECK'] }))
      .rejects.toThrow(/No existe la marca SURTECK\. Marcas registradas: FOY, SURTEK/)
    expect(client.didCall('suppliers', 'insert')).toBe(false)
  })

  test('edición: texto vacío borra el dato y las marcas se agregan/quitan sobre las actuales', async () => {
    const client = createMockSupabase({
      responses: {
        brands: BRANDS,
        'suppliers.select': suppliersSelect,
        'suppliers.update': { data: { id: S1 }, error: null },
        'supplier_brands.select': { data: [{ brand_id: 'b-surtek' }], error: null },
        'supplier_brands.insert': { data: null, error: null },
        'supplier_brands.delete': { data: null, error: null },
      },
    })
    const result = await saveSupplier(asDb(client), { proveedor: 'tornillos', telefono: '', agregar_marcas: ['FOY'], quitar_marcas: ['SURTEK'] })
    expect(client.updatePayload('suppliers')).toEqual({ phone: null })
    expect(filterValue(client.callsTo('suppliers', 'update')[0], 'id')).toBe(S1)
    expect(client.insertPayload('supplier_brands')).toEqual([{ supplier_id: S1, brand_id: 'b-foy' }])
    expect(filterValue(client.callsTo('supplier_brands', 'delete')[0], 'brand_id', 'in')).toEqual(['b-surtek'])
    expect(result.accion).toBe('actualizado')
  })

  test('alta sin nombre, edición sin cambios, crédito negativo y nombre repetido: error claro', async () => {
    const client = createMockSupabase({
      responses: {
        'suppliers.select': suppliersSelect,
        'suppliers.insert': { data: null, error: { code: '23505', message: 'duplicate' } },
      },
    })
    await expect(saveSupplier(asDb(client), { telefono: '443' })).rejects.toThrow(/nombre del proveedor es obligatorio/)
    await expect(saveSupplier(asDb(client), { proveedor: 'tornillos' })).rejects.toThrow(/No hay cambios/)
    await expect(saveSupplier(asDb(client), { nombre: 'X', dias_credito: -1 })).rejects.toThrow(/plazo de pago/)
    // A half-applied answer would read "creado" with the removal silently dropped (review PR #139).
    await expect(saveSupplier(asDb(client), { nombre: 'Nuevo', quitar_marcas: ['FOY'] })).rejects.toThrow(/no tiene marcas que quitar/)
    await expect(saveSupplier(asDb(client), { nombre: 'Tornillos MX' })).rejects.toThrow(/Ya existe un proveedor/)
  })
})

describe('save_supplier.crear_marcas (ADR-037, #155 D)', () => {
  const BRANDS = { data: [{ id: 'b-foy', name: 'FOY' }], error: null }
  const saved = supplier(S1, 'Ferretería López', 30, ['PRETUL'])
  const suppliersSelect = (rec: CallRecord) =>
    rec.single ? { data: saved, error: null } : { data: [{ id: S1, name: 'Ferretería López', payment_terms_days: 30 }], error: null }

  test('eval 14: la marca que no existe se da de alta normalizada, se liga al proveedor nuevo y el aviso la nombra', async () => {
    const client = createMockSupabase({
      responses: {
        'brands.select': BRANDS,
        'brands.insert': { data: { id: 'b-pretul', name: 'PRETUL' }, error: null },
        'suppliers.insert': { data: { ...saved }, error: null },
        'suppliers.select': suppliersSelect,
        'supplier_brands.insert': { data: null, error: null },
      },
    })
    const result = await saveSupplier(asDb(client), { nombre: 'Ferretería López', dias_credito: 30, agregar_marcas: [' pretul '], crear_marcas: true })
    expect(client.insertPayload('brands')).toEqual({ name: 'PRETUL' })
    expect(client.insertPayload('supplier_brands')).toEqual([{ supplier_id: S1, brand_id: 'b-pretul' }])
    expect(result).toMatchObject({ accion: 'creado', escrito: true, avisos: ['Marca nueva dada de alta: PRETUL.'] })
  })

  test('una marca que ya existe no se vuelve a crear; sin crear_marcas la nueva sigue siendo error; crear_marcas solo se aplica a agregar_marcas', async () => {
    const client = createMockSupabase({
      responses: {
        'brands.select': BRANDS,
        'suppliers.insert': { data: { ...saved }, error: null },
        'suppliers.select': suppliersSelect,
        'supplier_brands.insert': { data: null, error: null },
      },
    })
    const result = await saveSupplier(asDb(client), { nombre: 'Ferretería López', agregar_marcas: ['foy'], crear_marcas: true })
    expect(client.didCall('brands', 'insert')).toBe(false)
    expect(result).not.toHaveProperty('avisos')
    await expect(saveSupplier(asDb(client), { nombre: 'Otro', agregar_marcas: ['PRETUL'] })).rejects.toThrow(/No existe la marca PRETUL.*crear_marcas: true/)
    await expect(saveSupplier(asDb(client), { proveedor: 'lópez', quitar_marcas: ['PRETUL'], crear_marcas: true, agregar_marcas: ['FOY'] })).rejects.toThrow(/No existe la marca PRETUL/)
    await expect(saveSupplier(asDb(client), { nombre: 'Otro', crear_marcas: true })).rejects.toThrow(/crear_marcas va con agregar_marcas/)
    expect(client.didCall('brands', 'insert')).toBe(false)
  })

  test('un proveedor que no existe no deja una marca huérfana: se busca antes de dar de alta', async () => {
    const client = createMockSupabase({ responses: { 'brands.select': BRANDS, 'suppliers.select': { data: [], error: null } } })
    await expect(saveSupplier(asDb(client), { proveedor: 'nadie', telefono: '1', agregar_marcas: ['PRETUL'], crear_marcas: true })).rejects.toThrow()
    expect(client.didCall('brands', 'insert')).toBe(false)
  })
})

describe('createSupplier (store, #134)', () => {
  test('REGLA: el store no inserta un proveedor sin nombre aunque el llamador no lo haya validado (review PR #139)', async () => {
    const client = createMockSupabase()
    await expect(createSupplier(asDb(client), { phone: '443' })).rejects.toThrow(/nombre del proveedor es obligatorio/)
    await expect(createSupplier(asDb(client), { name: '   ' })).rejects.toThrow(/nombre del proveedor es obligatorio/)
    expect(client.didCall('suppliers', 'insert')).toBe(false)
  })
})
