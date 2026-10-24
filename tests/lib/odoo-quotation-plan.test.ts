/** Pure planning of the Odoo quotation tools (#144, ADR-040): nothing here reaches Odoo. */

import { describe, test, expect } from 'vitest'
import { OdooError } from '@/lib/odoo/client'
import { escapeLike, orDomain } from '@/lib/odoo/domains'
import {
  assertQuotationLines,
  confirmEffects,
  createLineVals,
  diffLines,
  DISPLAY_TEXT_MAX,
  invoiceReadiness,
  isEmptyDiff,
  linesAsInput,
  matchProducts,
  NOTE_ECHO_MAX,
  planQuotationLines,
  priceDifferences,
  productName,
  productSearchConditions,
  productsWithoutSat,
  quotationMode,
  unechoableReason,
  unechoableWarnings,
  type CurrentLine,
  type DesiredLine,
  type OdooProduct,
  type ReadinessLine,
  type ReadinessSale,
} from '@/lib/odoo/quotation-plan'
import { assertWriteAllowed } from '@/lib/odoo/write-catalog'

function product(id: number, name: string, overrides: Partial<OdooProduct> = {}): OdooProduct {
  return {
    id,
    name,
    etm: [],
    type: 'consu',
    invoicePolicy: 'delivery',
    saleOk: true,
    active: true,
    uom: 'Unidades',
    satKey: '27111700 Llaves',
    ...overrides,
  }
}

const MANGO = product(16971, '5467 Mango articulado cromado 1/2" URREA', { etm: ['510033153', '510022171'] })
const MANGO_SURTEK = product(17001, '5467 Mango articulado SURTEK')
const REPINTADO = product(30888, 'Re pintado', { type: 'service', invoicePolicy: 'order', satKey: '73181104 Pintura' })

function line(id: number, overrides: Partial<CurrentLine> = {}): CurrentLine {
  return {
    id,
    kind: 'producto',
    displayType: false,
    name: `Línea ${id}`,
    productId: 30888,
    qty: 1,
    price: 1,
    discount: 0,
    sequence: id * 10,
    subtotal: 1,
    ...overrides,
  }
}

const note = (id: number, name: string, sequence = id * 10): CurrentLine =>
  line(id, { kind: 'nota', displayType: 'line_note', name, productId: null, qty: 0, price: 0, sequence, subtotal: null })

describe('modo y forma de la entrada', () => {
  test('el modo sale de la entrada: crear, editar o revisar (confirmar es odoo_confirm_quotation, #155 B2b)', () => {
    expect(quotationMode({ cliente: '#1', lineas: [{ nota: 'x' }] })).toBe('crear')
    expect(quotationMode({ folio: 'S00912', lineas: [{ nota: 'x' }] })).toBe('editar')
    expect(quotationMode({ folio: 'S00912' })).toBe('revisar')
  })

  test('cliente con folio, crear sin líneas o una revisión con vigencia son errores', () => {
    expect(() => quotationMode({ cliente: '#1', folio: 'S00912' })).toThrow(/no los dos/)
    expect(() => quotationMode({ cliente: '#1' })).toThrow(/cliente y sus líneas/)
    expect(() => quotationMode({})).toThrow(/o el folio \(para revisar o editar\)/)
    expect(() => quotationMode({})).toThrow(OdooError)
    // A vigencia without lines would be signed and never written.
    expect(() => quotationMode({ folio: 'S00912', vigencia: '2026-10-30' })).toThrow(/La vigencia se cambia editando/)
    expect(quotationMode({ folio: 'S00912', lineas: [{ nota: 'x' }], vigencia: '2026-10-30' })).toBe('editar')
  })

  test('cada línea es producto, nota o sección; linea_id solo al editar y sin repetir', () => {
    expect(assertQuotationLines([{ nota: 'a' }, { seccion: 'b' }, { codigo: '5467', cantidad: 1, precio: 1 }], 'crear')).toEqual([
      'nota',
      'seccion',
      'producto',
    ])
    expect(() => assertQuotationLines([{ nota: 'a', seccion: 'b' }], 'crear')).toThrow(/no las dos/)
    expect(() => assertQuotationLines([{ nota: 'a', precio: 3 }], 'crear')).toThrow(/no lleva producto/)
    expect(() => assertQuotationLines([{ cantidad: 1, precio: 3 }], 'crear')).toThrow(/falta el producto/)
    expect(() => assertQuotationLines([{ codigo: '   ', cantidad: 1 }], 'crear')).toThrow(/falta el producto/)
    expect(() => assertQuotationLines([{ linea_id: 5, nota: 'a' }], 'crear')).toThrow(/solo sirve al editar/)
    expect(() => assertQuotationLines([{ linea_id: 5, nota: 'a' }, { linea_id: 5, nota: 'b' }], 'editar')).toThrow(/repetida/)
  })
})

describe('productos', () => {
  test('productName arma <código> <descripción> <MARCA>', () => {
    expect(productName('ZZTEST144', 'Producto de prueba del asistente', 'PRUEBA')).toBe(
      'ZZTEST144 Producto de prueba del asistente PRUEBA',
    )
    // Neither code nor brand repeated; spaces collapsed; brand upper-cased.
    expect(productName('7230', '7230   PINZA de presión surtek', 'Surtek')).toBe('7230 PINZA de presión surtek')
    expect(productName('7230', 'PINZA de presión', ' surtek ')).toBe('7230 PINZA de presión SURTEK')
    expect(productName(undefined, 'Re pintado')).toBe('Re pintado')
  })

  test('matchProducts: exacto primero; 0 → nuevo; más de 1 → ambiguo; archivado o no se vende bloquea', () => {
    const archived = product(40, '9001 Llave archivada URREA', { active: false })
    const notSold = product(41, '9002 Llave interna URREA', { saleOk: false })
    const twins = [product(50, 'Suministro'), product(51, 'Suministro'), product(52, 'suministro ')]
    const rows = [MANGO, MANGO_SURTEK, REPINTADO, archived, notSold, ...twins]
    const [byId, byCode, byCodeBrand, missing, other, ambiguous, archivedMatch, notSoldMatch, exactName] = matchProducts(
      [
        { producto_id: 30888 },
        { codigo: '5467', marca: 'URREA' },
        // The exact full name breaks a tie between same-code products.
        { codigo: '5467', descripcion: 'Mango articulado SURTEK' },
        { codigo: '7230', descripcion: 'PINZA', marca: 'SURTEK' },
        { codigo: '5467', descripcion: 'Mango', marca: 'TRUPER' },
        { descripcion: 'Suministro' },
        { codigo: '9001' },
        { producto_id: 41 },
        { descripcion: 're PINTADO' },
      ],
      rows,
    )
    expect(byId).toMatchObject({ estado: 'existe', producto: { id: 30888 } })
    expect(byCode).toMatchObject({ estado: 'existe', producto: { id: 16971 } })
    expect(byCodeBrand).toMatchObject({ estado: 'existe', producto: { id: 17001 } })
    expect(missing).toEqual({ estado: 'nuevo', otraMarca: [] })
    // Same code under other brands: still new, but the preview gets them to warn.
    expect(other).toMatchObject({ estado: 'nuevo', otraMarca: [{ id: 16971 }, { id: 17001 }] })
    expect(ambiguous).toMatchObject({ estado: 'ambiguo', total: 3, motivo: '3 productos se llaman "Suministro"' })
    expect(archivedMatch).toMatchObject({ estado: 'bloqueado', motivo: expect.stringContaining('archivado: reactívalo en Odoo') })
    expect(notSoldMatch).toMatchObject({ estado: 'bloqueado', motivo: expect.stringContaining('no se puede vender') })
    expect(exactName).toMatchObject({ estado: 'existe', producto: { id: 30888 } })

    // Two products with the same code and no brand to tell them apart: never a guess.
    expect(matchProducts([{ codigo: '5467' }], rows)[0]).toMatchObject({ estado: 'ambiguo', total: 2 })
    // A producto_id that doesn't exist is not "new": it's an error to fix.
    expect(matchProducts([{ producto_id: 999 }], rows)[0]).toMatchObject({ estado: 'bloqueado', motivo: 'el producto #999 no existe en Odoo' })
    // Notes and sections don't match products.
    expect(matchProducts([{ nota: 'x' }], rows)).toEqual([null])
  })

  test('el ETM en lista con comas coincide exacto', () => {
    const lookalike = product(77, '8888 Otra llave URREA', { etm: ['5100331530'] })
    const rows = [MANGO, lookalike]
    const [single, inList, both, conflict, unknown] = matchProducts(
      [
        { etm: '510022171' },
        { etm: '510033153, 510022171' },
        { etm: '510033153', codigo: '5467', marca: 'urrea' },
        { etm: '510033153', codigo: '8888' },
        { etm: '510099999', codigo: '8888' },
      ],
      rows,
    )
    expect(single).toMatchObject({ estado: 'existe', producto: { id: 16971 } })
    expect(inList).toMatchObject({ estado: 'existe', producto: { id: 16971 } })
    expect(both).toMatchObject({ estado: 'existe', producto: { id: 16971 } })
    expect(conflict).toMatchObject({ estado: 'bloqueado', motivo: expect.stringContaining('apuntan a productos distintos') })
    // An ETM Odoo doesn't have leaves the decision to the code.
    expect(unknown).toMatchObject({ estado: 'existe', producto: { id: 77 } })
  })

  test('la línea existente manda: su producto, y cambiarlo es quitarla y agregar otra', () => {
    const lineProducts = new Map<number, number | null>([[9, 30888], [10, null]])
    const [kept, swapped, display, foreign] = matchProducts(
      [{ linea_id: 9 }, { linea_id: 9, producto_id: 16971 }, { linea_id: 10 }, { linea_id: 11 }],
      [REPINTADO, MANGO],
      { lineProducts },
    )
    expect(kept).toMatchObject({ estado: 'existe', producto: { id: 30888 } })
    expect(swapped).toMatchObject({ estado: 'bloqueado', motivo: 'para cambiar de producto, quita la línea y agrega otra' })
    expect(display).toMatchObject({ estado: 'bloqueado', motivo: expect.stringContaining('nota o sección') })
    expect(foreign).toMatchObject({ estado: 'bloqueado', motivo: 'la línea 11 no es de esta cotización' })
  })

  test('si la búsqueda llegó a su tope, nada se resuelve por nombre ni código', () => {
    const [byCode, byId] = matchProducts([{ codigo: '5467', marca: 'URREA' }, { producto_id: 16971 }], [MANGO], { truncated: true })
    expect(byCode).toMatchObject({ estado: 'bloqueado', motivo: expect.stringContaining('demasiadas coincidencias') })
    expect(byId).toMatchObject({ estado: 'existe' })
  })

  test('la búsqueda cubre código, ETM y nombre exacto, con los comodines escapados', () => {
    expect(productSearchConditions({ codigo: '54_67', etm: '510033153, 510022171', descripcion: 'x' })).toEqual([
      ['name', '=ilike', '54\\_67 %'],
      ['default_code', 'ilike', '510033153'],
      ['default_code', 'ilike', '510022171'],
    ])
    expect(productSearchConditions({ descripcion: '100% algodón', marca: 'acme' })).toEqual([
      ['name', '=ilike', '100\\% algodón'],
      ['name', '=ilike', '100\\% algodón ACME'],
    ])
    expect(productSearchConditions({ producto_id: 4, codigo: '5467' })).toEqual([])
    expect(productSearchConditions({ linea_id: 4 })).toEqual([])
  })
})

describe('plan de líneas', () => {
  test('bloqueos y avisos: ambiguo, faltan datos, nuevo sin código, precio 0 y sin clave SAT', () => {
    const lines = [
      { descripcion: 'Suministro', cantidad: 1, precio: 10 },
      { codigo: '5467', marca: 'URREA', precio: 5 },
      { descripcion: 'Algo que no existe', cantidad: 1, precio: 1 },
      { producto_id: 16971, cantidad: 2, precio: 0 },
      { codigo: 'zz1', descripcion: 'Nuevo', marca: 'prueba', cantidad: 1, precio: 3, etm: '12' },
    ]
    const rows = [MANGO, product(50, 'Suministro'), product(51, 'Suministro')]
    const plan = planQuotationLines({ mode: 'crear', lines, matches: matchProducts(lines, rows) })
    expect(plan.bloqueos).toEqual([
      'Línea 1: 2 productos se llaman "Suministro": elige uno (producto_id).',
      'Línea 2: falta la cantidad.',
      'Línea 3: el producto no existe en Odoo; para darlo de alta hacen falta su código y su descripción.',
      'Línea 5: el ETM debe ser de 9 dígitos (o varios separados por comas).',
    ])
    expect(plan.avisos).toContain('Línea 4: precio 0 — confírmalo antes de guardar.')
    expect(plan.lineas[0]).toMatchObject({ estado: 'ambiguo', candidatos: [{ id: 50 }, { id: 51 }] })
    expect(plan.pendingNew).toEqual([3, 5])
  })

  test('los productos nuevos salen para la vista y para el alta, sin null ni campos de pantalla', () => {
    const lines = [
      { nota: 'PRUEBA #144 — no procesar' },
      { producto_id: 30888, cantidad: 1, precio: 1 },
      { codigo: 'zztest144', descripcion: 'Producto de prueba del asistente', marca: 'prueba', cantidad: 1, precio: 1 },
      { codigo: 'ZZTEST144', descripcion: 'Producto de prueba del asistente', marca: 'PRUEBA', cantidad: 2, precio: 1 },
    ]
    const plan = planQuotationLines({ mode: 'crear', lines, matches: matchProducts(lines, [REPINTADO]) })
    expect(plan.bloqueos).toEqual([])
    // Two lines, one product to create.
    expect(plan.paraAlta).toEqual([
      { codigo: 'ZZTEST144', descripcion: 'Producto de prueba del asistente', marca: 'PRUEBA', precio: 1 },
    ])
    expect(plan.nuevos).toEqual([
      {
        codigo: 'ZZTEST144',
        descripcion: 'Producto de prueba del asistente',
        marca: 'PRUEBA',
        etm: null,
        precio: 1,
        clave_sat: null,
        nombre_en_odoo: 'ZZTEST144 Producto de prueba del asistente PRUEBA',
        // The suggestions come from the one read of the preview (#154), never from the plan.
        categoria_sat: null,
        clave_sat_propuesta: null,
        sugerencias_sat: [],
      },
    ])
    expect(plan.lineas[2]).toMatchObject({ estado: 'nuevo', propuesto: { nombre: 'ZZTEST144 Producto de prueba del asistente PRUEBA' } })
    expect(plan.avisos).toEqual(['Líneas 3 y 4 sin clave SAT: no podrán timbrarse hasta capturarla en Odoo.'])
    expect(plan.subtotal).toBe(4)
    expect(plan.pendingNew).toEqual([3, 4])
  })

  test('productos existentes sin clave SAT: una vez cada uno, con la clave o la categoría que trajo su línea (#154)', () => {
    const NO_KEY = product(32300, 'ZZTEST144 Producto de prueba del asistente PRUEBA', { satKey: null })
    const lines = [
      { producto_id: 32300, cantidad: 1, precio: 1, categoria_sat: '  pinturas   en aerosol ' },
      { producto_id: 30888, cantidad: 1, precio: 1 },
      { producto_id: 32300, cantidad: 2, precio: 1, clave_sat: '31211507' },
      { codigo: 'ZZNUEVO', descripcion: 'Brocha de 4 pulgadas', cantidad: 1, precio: 1, categoria_sat: 'brochas' },
    ]
    const plan = planQuotationLines({ mode: 'crear', lines, matches: matchProducts(lines, [NO_KEY, REPINTADO]) })
    expect(productsWithoutSat(plan.lineas, lines)).toEqual([
      {
        producto_id: 32300,
        nombre: NO_KEY.name,
        lineas: [1, 3],
        clave_sat: '31211507',
        categoria_sat: 'pinturas en aerosol',
        clave_sat_propuesta: null,
        sugerencias_sat: [],
      },
    ])
    // A new product keeps its own categoria_sat; a product with its key never shows up.
    expect(plan.nuevos[0]).toMatchObject({ nombre_en_odoo: 'ZZNUEVO Brocha de 4 pulgadas', categoria_sat: 'brochas' })
    // Review: Odoo's lines, no requests.
    expect(productsWithoutSat(plan.lineas).map((p) => [p.producto_id, p.clave_sat, p.categoria_sat])).toEqual([[32300, null, null]])
  })

  test('una nota o sección no lleva categoria_sat', () => {
    expect(() => assertQuotationLines([{ nota: 'x', categoria_sat: 'pinturas' }], 'crear')).toThrow(/no lleva producto/)
  })

  test('crear: secuencias de 10 en 10, nota primero, y el catálogo de escritura las acepta', () => {
    const lines = [
      { nota: 'PRUEBA #144 — no procesar' },
      { producto_id: 30888, cantidad: 1, precio: 1 },
      { codigo: '5467', marca: 'URREA', cantidad: 3, precio: 950.98, descuento: 5 },
    ]
    const plan = planQuotationLines({ mode: 'crear', lines, matches: matchProducts(lines, [REPINTADO, MANGO]) })
    const vals = createLineVals(plan.desired)
    expect(vals).toEqual([
      { display_type: 'line_note', name: 'PRUEBA #144 — no procesar', sequence: 10 },
      { product_id: 30888, product_uom_qty: 1, price_unit: 1, discount: 0, sequence: 20 },
      { product_id: 16971, product_uom_qty: 3, price_unit: 950.98, discount: 5, sequence: 30 },
    ])
    expect(plan.subtotal).toBe(2711.29)
    const payload = {
      vals_list: [
        { partner_id: 1, origin: 'Asistente DYMMSA · 0123456789', internal_note: '<p>x</p>', order_line: vals.map((v) => [0, 0, v]) },
      ],
    }
    expect(() => assertWriteAllowed('sale.order', 'create', payload)).not.toThrow()
  })
})

describe('diff de una edición', () => {
  const current = [note(1, 'PRUEBA #144 — no procesar'), line(2, { productId: 30888 }), line(3, { productId: 99 })]

  test('diffLines conserva, cambia (con precio y descuento), quita y agrega', () => {
    const desired: DesiredLine[] = [
      { n: 1, kind: 'nota', lineaId: 1, text: 'PRUEBA #144 — no procesar' },
      { n: 2, kind: 'producto', lineaId: 2, productId: 30888, qty: 2, price: 1, discount: 0 },
      { n: 3, kind: 'producto', productId: 16971, qty: 1, price: 950.98 },
    ]
    const diff = diffLines(current, desired)
    expect(diff.actions.map((a) => a.action)).toEqual(['se_queda', 'cambia', 'nueva'])
    expect(diff.removed.map((l) => l.id)).toEqual([3])
    expect(diff.commands).toEqual([
      // The trio always together on a product line: v19 recomputes the price from the quantity.
      [1, 2, { product_uom_qty: 2, price_unit: 1, discount: 0 }],
      [0, 0, { product_id: 16971, product_uom_qty: 1, price_unit: 950.98, discount: 0, sequence: 30 }],
      [2, 3, 0],
    ])
    expect(isEmptyDiff(diff)).toBe(false)
    expect(() =>
      assertWriteAllowed('sale.order', 'write', { ids: [912], vals: { order_line: diff.commands, internal_note: '<p>x</p>' } }),
    ).not.toThrow()
  })

  test('lo mismo que ya tiene es un diff vacío; un texto distinto cambia solo el nombre', () => {
    const same: DesiredLine[] = [
      { n: 1, kind: 'nota', lineaId: 1, text: 'PRUEBA #144 — no procesar' },
      { n: 2, kind: 'producto', lineaId: 2, productId: 30888, qty: 1, price: 1 },
      { n: 3, kind: 'producto', lineaId: 3, productId: 99, qty: 1, price: 1, discount: 0 },
    ]
    expect(isEmptyDiff(diffLines(current, same))).toBe(true)
    const renamed = diffLines(current, [{ ...same[0], text: 'Entrega en 3 días' }, same[1], same[2]])
    expect(renamed.commands).toEqual([[1, 1, { name: 'Entrega en 3 días' }]])
  })

  test('un reintento de una edición que agregó líneas las encuentra: ya estaba así', () => {
    // After the first (uncertain) save the sale already has the new line 4 at sequence 30.
    const applied = [note(1, 'PRUEBA #144 — no procesar'), line(2, { qty: 2 }), line(4, { productId: 16971, price: 950.98, sequence: 30 })]
    const retry: DesiredLine[] = [
      { n: 1, kind: 'nota', lineaId: 1, text: 'PRUEBA #144 — no procesar' },
      { n: 2, kind: 'producto', lineaId: 2, productId: 30888, qty: 2, price: 1, discount: 0 },
      { n: 3, kind: 'producto', productId: 16971, qty: 1, price: 950.98 },
    ]
    const diff = diffLines(applied, retry)
    expect(isEmptyDiff(diff)).toBe(true)
    expect(diff.actions.map((a) => a.lineId)).toEqual([1, 2, 4])
  })

  test('reordenar reasigna secuencias, y la línea de producto lleva su trío', () => {
    const desired: DesiredLine[] = [
      { n: 1, kind: 'producto', lineaId: 2, productId: 30888, qty: 1, price: 1 },
      { n: 2, kind: 'nota', lineaId: 1, text: 'PRUEBA #144 — no procesar' },
    ]
    const diff = diffLines(current, desired)
    expect(diff.commands).toEqual([
      [1, 2, { product_uom_qty: 1, price_unit: 1, discount: 0, sequence: 10 }],
      [1, 1, { sequence: 20 }],
      [2, 3, 0],
    ])
  })

  test('una línea nueva en medio reordena; una sin producto deja el diff incompleto', () => {
    const middle: DesiredLine[] = [
      { n: 1, kind: 'nota', lineaId: 1, text: 'PRUEBA #144 — no procesar' },
      { n: 2, kind: 'seccion', text: 'Herramienta' },
      { n: 3, kind: 'producto', lineaId: 2, productId: 30888, qty: 1, price: 1 },
      { n: 4, kind: 'producto', lineaId: 3, productId: 99, qty: 1, price: 1 },
    ]
    expect(diffLines(current, middle).commands).toEqual([
      [0, 0, { display_type: 'line_section', name: 'Herramienta', sequence: 20 }],
      [1, 2, { product_uom_qty: 1, price_unit: 1, discount: 0, sequence: 30 }],
      [1, 3, { product_uom_qty: 1, price_unit: 1, discount: 0, sequence: 40 }],
    ])
    const pending = diffLines(current, [{ n: 1, kind: 'producto', qty: 1, price: 1 }])
    expect(pending.commands).toBeNull()
    expect(pending.actions).toEqual([{ n: 1, action: 'nueva', lineId: null }])
  })

  test('una referencia a una línea ajena o de otro tipo no llega a un comando', () => {
    expect(() => diffLines(current, [{ n: 1, kind: 'producto', lineaId: 77, productId: 1, qty: 1, price: 1 }])).toThrow(OdooError)
    expect(() => diffLines(current, [{ n: 1, kind: 'producto', lineaId: 1, productId: 1, qty: 1, price: 1 }])).toThrow(OdooError)
  })

  test('el plan de edición marca la acción de cada línea y agrega las que se quitan', () => {
    const lines = [
      { linea_id: 1, nota: 'PRUEBA #144 — no procesar' },
      { linea_id: 2, cantidad: 3, precio: 1 },
    ]
    const lineProducts = new Map<number, number | null>([[1, null], [2, 30888], [3, 99]])
    const plan = planQuotationLines({
      mode: 'editar',
      lines,
      matches: matchProducts(lines, [REPINTADO], { lineProducts }),
      current,
    })
    expect(plan.lineas.map((l) => [l.n, l.accion])).toEqual([
      [1, 'se_queda'],
      [2, 'cambia'],
      [null, 'se_quita'],
    ])
    expect(plan.lineas[1]).toMatchObject({ antes: { cantidad: 1, precio: 1, descuento: 0 } })
    // A note given as a product (or the other way round) blocks instead of guessing.
    const mixed = [{ linea_id: 2, nota: 'x' }]
    const blocked = planQuotationLines({ mode: 'editar', lines: mixed, matches: matchProducts(mixed, [], { lineProducts }), current })
    expect(blocked.bloqueos).toEqual([expect.stringContaining('es un producto en Odoo')])
    expect(blocked.diff).toBeNull()
  })

  test('una nota larga del dueño se conserva; una nueva o cambiada de más de 300 bloquea', () => {
    const long = 'x'.repeat(DISPLAY_TEXT_MAX + 50)
    const owned = [note(1, long), line(2)]
    const lineProducts = new Map<number, number | null>([[1, null], [2, 30888]])
    const plan = (lines: { linea_id?: number; nota?: string; cantidad?: number; precio?: number }[]) =>
      planQuotationLines({ mode: 'editar', lines, matches: matchProducts(lines, [REPINTADO], { lineProducts }), current: owned })

    const kept = plan([{ linea_id: 1, nota: long }, { linea_id: 2, cantidad: 2, precio: 1 }])
    expect(kept.bloqueos).toEqual([])
    expect(kept.diff?.commands).toEqual([[1, 2, { product_uom_qty: 2, price_unit: 1, discount: 0 }]])
    const message = `una nota o sección nueva o cambiada lleva hasta ${DISPLAY_TEXT_MAX} caracteres`
    expect(plan([{ linea_id: 1, nota: `${long}!` }, { linea_id: 2, cantidad: 1, precio: 1 }]).bloqueos).toEqual([`Línea 1: ${message}.`])
    expect(plan([{ linea_id: 1, nota: long }, { linea_id: 2, cantidad: 1, precio: 1 }, { nota: `${long}?` }]).bloqueos).toEqual([
      `Línea 3: ${message}.`,
    ])
    const created = [{ nota: long }]
    expect(planQuotationLines({ mode: 'crear', lines: created, matches: matchProducts(created, []) }).bloqueos).toEqual([
      `Línea 1: ${message}.`,
    ])

    // The limit is the write catalog's own.
    const createWith = (name: string) => ({
      vals_list: [
        {
          partner_id: 1,
          origin: 'Asistente DYMMSA · 0123456789',
          internal_note: '<p>x</p>',
          order_line: [[0, 0, { display_type: 'line_note', name, sequence: 10 }]],
        },
      ],
    })
    expect(() => assertWriteAllowed('sale.order', 'create', createWith('x'.repeat(DISPLAY_TEXT_MAX)))).not.toThrow()
    expect(() => assertWriteAllowed('sale.order', 'create', createWith('x'.repeat(DISPLAY_TEXT_MAX + 1)))).toThrow(OdooError)
  })

  test('las líneas actuales como entrada llevan su linea_id', () => {
    expect(linesAsInput([note(1, 'Nota'), line(2, { discount: 10 }), line(3, { kind: 'seccion', displayType: 'line_section', name: 'S', productId: null })])).toEqual([
      { linea_id: 1, nota: 'Nota' },
      { linea_id: 2, producto_id: 30888, cantidad: 1, precio: 1, descuento: 10 },
      { linea_id: 3, seccion: 'S' },
    ])
  })

  test('una línea fuera de los límites de la entrada no se ofrece como entrada ni se toca al editar', () => {
    const cases: [CurrentLine, string][] = [
      [line(4, { price: -500, name: 'Descuento' }), 'tiene precio -500'],
      [line(5, { qty: 0 }), 'tiene cantidad 0'],
      [line(6, { qty: 100_001 }), 'tiene cantidad 100001'],
      [line(7, { discount: 120 }), 'tiene descuento de 120 %'],
      [line(8, { productId: null }), 'no tiene producto'],
      [note(9, '   '), 'no tiene texto'],
      [note(10, 'x'.repeat(NOTE_ECHO_MAX + 1)), `pasa de ${NOTE_ECHO_MAX} caracteres`],
    ]
    for (const [current, why] of cases) expect(unechoableReason(current), why).toBe(why)
    expect(unechoableReason(line(2, { discount: 10 }))).toBeNull()
    expect(unechoableReason(note(1, 'x'.repeat(NOTE_ECHO_MAX)))).toBeNull()

    const sale = [note(1, 'Nota'), line(2), line(4, { price: -500, name: 'Descuento' })]
    expect(linesAsInput(sale).map((l) => l.linea_id)).toEqual([1, 2])
    expect(unechoableWarnings(sale)).toEqual([
      'La línea 3 («Descuento») tiene precio -500: el asistente no puede conservarla al editar (no viene en lineas_como_entrada); para cambiar esta cotización, hazlo en Odoo. Confirmarla sí se puede.',
    ])

    const lineProducts = new Map<number, number | null>([[1, null], [2, 30888], [4, 30888]])
    const plan = (lines: { linea_id?: number; nota?: string; cantidad?: number; precio?: number }[]) =>
      planQuotationLines({ mode: 'editar', lines, matches: matchProducts(lines, [REPINTADO], { lineProducts }), current: sale })
    const stuck = 'La línea #4 («Descuento») tiene precio -500: el asistente no puede conservarla ni cambiarla; edita esta cotización en Odoo.'
    // Left out (it would be removed) or rewritten to a valid price: both drop the owner's discount.
    expect(plan([...linesAsInput(sale), { nota: 'Otra' }]).bloqueos).toEqual([stuck])
    expect(plan([...linesAsInput(sale), { linea_id: 4, cantidad: 1, precio: 0 }]).bloqueos).toEqual([stuck])
  })

  test('priceDifferences compara lo pedido contra lo que Odoo guardó', () => {
    const expected = [
      { n: 2, lineId: 2, productId: 30888, price: 1 },
      { n: 3, lineId: null, productId: 16971, price: 950.98 },
    ]
    const rows = [
      { id: 2, productId: 30888, price: 1 },
      { id: 3, productId: 16971, price: 900 },
      { id: 8, productId: 16971, price: 940 },
    ]
    // Line 3 existed before the edit: the new line is 8.
    expect(priceDifferences(expected, rows, new Set([2, 3]))).toEqual([{ linea: 3, pedido: 950.98, en_odoo: 940 }])
  })
})

describe('efectos de confirmar', () => {
  test('confirmEffects cuenta bienes, servicios y facturables', () => {
    const products = new Map([
      [16971, MANGO],
      [30888, REPINTADO],
      [5, product(5, 'Instalación', { type: 'service', invoicePolicy: 'delivery' })],
    ])
    const effects = confirmEffects([{ productId: 16971 }, { productId: 16971 }, { productId: 30888 }, { productId: 5 }, {}], products)
    expect(effects).toMatchObject({ bienes: 3, servicios: 2, facturables: 1 })
    expect(effects.texto).toBe(
      'Odoo creará la entrega OFI/OUT de 3 bienes (se facturan cuando la validen en Odoo); 1 servicio se factura cuando se capture en Odoo la cantidad entregada; 1 línea se podrá facturar en cuanto se confirme; la fecha de la orden pasará a hoy. No se manda correo al cliente.',
    )
    expect(confirmEffects([{ productId: 30888 }], products).texto).toBe(
      '1 línea se podrá facturar en cuanto se confirme; la fecha de la orden pasará a hoy. No se manda correo al cliente.',
    )
    expect(confirmEffects([], products).texto).toMatch(/no se puede confirmar/)
  })
})

describe('preparación de la factura', () => {
  const sale = (overrides: Partial<ReadinessSale> = {}): ReadinessSale => ({
    name: 'S00912',
    state: 'sale',
    invoiceStatus: 'to invoice',
    amountTotal: 2.32,
    ...overrides,
  })
  const saleLine = (overrides: Partial<ReadinessLine> = {}): ReadinessLine => ({
    name: 'Re pintado',
    displayType: false,
    productId: 30888,
    isDownpayment: false,
    qty: 2,
    qtyDelivered: 0,
    qtyInvoiced: 0,
    qtyToInvoice: 2,
    price: 1,
    ...overrides,
  })
  const products = new Map([
    [30888, REPINTADO],
    [16971, MANGO],
  ])
  const goods = saleLine({ name: '5467 Mango', productId: 16971, qtyToInvoice: 0 })
  const picking = [{ name: 'OFI/OUT/00650', state: 'assigned' }]
  const motive = (...args: Parameters<typeof invoiceReadiness>) => {
    const result = invoiceReadiness(...args)
    return result.estado === 'bloqueada' ? result.motivo : result.estado
  }

  test('invoiceReadiness: cada motivo con su mensaje, incluidos total ≤ 0, negativos y sobre-entrega', () => {
    expect(motive(sale({ state: 'draft' }), [saleLine()], products, [])).toBe(
      'La S00912 sigue como cotización: primero confírmala (vista previa con el folio y, con tu sí, odoo_confirm_quotation).',
    )
    expect(motive(sale({ state: 'cancel' }), [saleLine()], products, [])).toBe('La S00912 está cancelada.')
    expect(
      invoiceReadiness(sale(), [saleLine()], products, [], [{ id: 1300, name: false, state: 'draft', moveType: 'out_invoice', amountTotal: 2.32 }]),
    ).toEqual({ estado: 'ya_existe', factura: { id: 1300, total: 2.32 } })
    expect(
      motive(sale(), [saleLine()], products, [], [{ id: 1210, name: 'F00609', state: 'posted', moveType: 'out_invoice', amountTotal: 2.32 }]),
    ).toBe('La S00912 ya está facturada (F00609): las facturas parciales o adicionales se hacen en Odoo.')
    // A cancelled invoice doesn't count.
    expect(motive(sale(), [saleLine()], products, [], [{ id: 1, name: 'F1', state: 'cancel', moveType: 'out_invoice', amountTotal: 1 }])).toBe('lista')
    expect(motive(sale(), [saleLine(), saleLine({ isDownpayment: true })], products, [])).toBe(
      'La S00912 tiene anticipos: la factura final hazla en Odoo.',
    )
    const creditNote = 'Odoo convertiría la S00912 en nota de crédito: hazla en Odoo.'
    expect(motive(sale({ amountTotal: 0 }), [saleLine()], products, [])).toBe(creditNote)
    expect(motive(sale(), [saleLine(), saleLine({ price: -5 })], products, [])).toBe(creditNote)
    expect(motive(sale(), [saleLine({ qtyToInvoice: -1 })], products, [])).toBe(creditNote)
    const over = 'Se entregó más de lo vendido en «Re pintado»: ajusta la venta o factura en Odoo.'
    expect(motive(sale(), [saleLine({ qtyToInvoice: 3 })], products, [])).toBe(over)
    expect(motive(sale({ invoiceStatus: 'upselling' }), [saleLine({ qtyDelivered: 3 })], products, [])).toBe(over)
    expect(motive(sale(), [goods], products, picking)).toBe(
      'Nada que facturar todavía: 1 bien se factura por entrega y la entrega OFI/OUT/00650 está «Lista», sin validar. Valídala en Odoo y vuelve a pedírmelo. El asistente no toca inventario.',
    )
    expect(motive(sale(), [saleLine(), { ...goods, qtyDelivered: 1, qtyToInvoice: 1 }], products, picking)).toBe(
      'Solo está entregada una parte (1 de 2 líneas): la factura del asistente es siempre completa.',
    )
    const service = saleLine({ name: 'Instalación', productId: 5, qtyToInvoice: 0 })
    const withService = new Map([...products, [5, product(5, 'Instalación', { type: 'service' })]])
    expect(motive(sale(), [service], withService, [])).toBe('Captura la cantidad entregada del servicio «Instalación» en la venta en Odoo.')
  })

  test('completa es cada línea con todo por facturar, y las notas no cuentan', () => {
    const lines = [saleLine({ displayType: 'line_note', name: 'PRUEBA', productId: null, qty: 0, qtyToInvoice: 0 }), saleLine()]
    expect(invoiceReadiness(sale(), lines, products, [])).toEqual({ estado: 'lista' })
    expect(motive(sale(), [saleLine({ displayType: 'line_note', productId: null })], products, [])).toBe(
      'La S00912 no tiene productos que facturar.',
    )
  })
})

describe('dominios', () => {
  test('orDomain arma la notación prefija', () => {
    expect(orDomain([['a', '=', 1]])).toEqual([['a', '=', 1]])
    expect(orDomain([['a', '=', 1], ['b', '=', 2], ['c', '=', 3]])).toEqual(['|', '|', ['a', '=', 1], ['b', '=', 2], ['c', '=', 3]])
    // OR of nothing is false, never "everything".
    expect(orDomain([])).toEqual([['id', 'in', []]])
  })

  test('escapeLike escapa %, _ y \\', () => {
    expect(escapeLike('100%_a\\b')).toBe('100\\%\\_a\\\\b')
    expect(escapeLike('5467 Mango')).toBe('5467 Mango')
  })
})
