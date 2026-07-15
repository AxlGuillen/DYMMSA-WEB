import { describe, test, expect } from 'vitest'
import {
  DEFAULT_PURCHASE_THRESHOLDS,
  SETTING_THRESHOLD_MONEY,
  SETTING_THRESHOLD_PCT,
  resolveThresholds,
  consolidateOrderItems,
  computeGroupMath,
  recommendPurchase,
  applyChoice,
  isDecisionStale,
  buildPurchasePlan,
  type PlannableItem,
  type CatalogEntry,
  type PurchaseThresholds,
} from '@/lib/purchase-plan'
import type { OrderPurchaseDecision } from '@/types/database'

const T: PurchaseThresholds = DEFAULT_PURCHASE_THRESHOLDS

let seq = 0
function item(overrides: Partial<PlannableItem> = {}): PlannableItem {
  seq++
  return {
    id: `item-${seq}`,
    item_type: 'product',
    etm: `ETM-${seq}`,
    model_code: 'URR-1',
    brand: 'URREA',
    section_label: null,
    quantity_to_order: 5,
    unit_price: 100,
    ...overrides,
  }
}

function decision(overrides: Partial<OrderPurchaseDecision> = {}): OrderPurchaseDecision {
  return {
    id: 'd1',
    order_id: 'o1',
    model_code: 'URR-1',
    brand: 'URREA',
    std_snapshot: 10,
    needed_qty: 10,
    packages_wholesale: 1,
    qty_retail: 0,
    decided_at: '2026-07-15T00:00:00Z',
    ...overrides,
  }
}

function catalog(entries: Record<string, CatalogEntry>): Map<string, CatalogEntry> {
  return new Map(Object.entries(entries))
}

// ─── resolveThresholds ───────────────────────────────────────────────────

describe('resolveThresholds', () => {
  test('sin filas → defaults', () => {
    expect(resolveThresholds({})).toEqual({ money: 100, pct: 0.8 })
  })

  test('valores válidos ganan a los defaults', () => {
    expect(
      resolveThresholds({ [SETTING_THRESHOLD_MONEY]: 250, [SETTING_THRESHOLD_PCT]: 0.5 }),
    ).toEqual({ money: 250, pct: 0.5 })
  })

  test('valores inválidos caen al default', () => {
    expect(resolveThresholds({ [SETTING_THRESHOLD_MONEY]: -5 }).money).toBe(100)
    expect(resolveThresholds({ [SETTING_THRESHOLD_MONEY]: 'garbage' }).money).toBe(100)
    expect(resolveThresholds({ [SETTING_THRESHOLD_PCT]: 1.5 }).pct).toBe(0.8)
    expect(resolveThresholds({ [SETTING_THRESHOLD_PCT]: 0 }).pct).toBe(0.8)
    expect(resolveThresholds({ [SETTING_THRESHOLD_PCT]: NaN }).pct).toBe(0.8)
  })
})

// ─── consolidateOrderItems ───────────────────────────────────────────────

describe('consolidateOrderItems', () => {
  test('duplicados entre secciones se funden en un grupo (5+5)', () => {
    const groups = consolidateOrderItems([
      item({ model_code: 'URR-1', quantity_to_order: 5, section_label: 'A' }),
      item({ model_code: 'URR-1', quantity_to_order: 5, section_label: 'B' }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].needed).toBe(10)
    expect(groups[0].lines).toHaveLength(2)
  })

  test('casing y espacios en code/brand no fragmentan el grupo', () => {
    const groups = consolidateOrderItems([
      item({ model_code: ' urr-1 ', brand: 'urrea' }),
      item({ model_code: 'URR-1', brand: 'URREA' }),
      item({ model_code: 'URR-1', brand: '' }), // marca vacía → DEFAULT_BRAND
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].modelCode).toBe('URR-1')
    expect(groups[0].brand).toBe('URREA')
    expect(groups[0].needed).toBe(15)
  })

  test('la misma marca con distinto código NO se funde; misma código otra marca tampoco', () => {
    const groups = consolidateOrderItems([
      item({ model_code: 'URR-1', brand: 'URREA' }),
      item({ model_code: 'URR-2', brand: 'URREA' }),
      item({ model_code: 'URR-1', brand: 'SURTEK' }),
    ])
    expect(groups).toHaveLength(3)
  })

  test('separadores y quantity_to_order=0 se excluyen', () => {
    const groups = consolidateOrderItems([
      item({ item_type: 'separator', quantity_to_order: 5 }),
      item({ quantity_to_order: 0 }),
      item({ quantity_to_order: 3 }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].needed).toBe(3)
  })

  test('ítems sin model_code NO se fusionan entre sí (cada uno es su grupo)', () => {
    const groups = consolidateOrderItems([
      item({ model_code: '', quantity_to_order: 2 }),
      item({ model_code: '  ', quantity_to_order: 3 }),
    ])
    expect(groups).toHaveLength(2)
  })

  test('precio del grupo = promedio ponderado por cantidad', () => {
    const groups = consolidateOrderItems([
      item({ quantity_to_order: 2, unit_price: 100 }),
      item({ quantity_to_order: 8, unit_price: 50 }),
    ])
    // (2×100 + 8×50) / 10 = 60
    expect(groups[0].unitPrice).toBe(60)
  })

  test('líneas con precio 0 se excluyen del promedio (0 = sin capturar)', () => {
    const groups = consolidateOrderItems([
      item({ quantity_to_order: 5, unit_price: 0 }),
      item({ quantity_to_order: 5, unit_price: 80 }),
    ])
    expect(groups[0].unitPrice).toBe(80)
  })

  test('todas las líneas sin precio → unitPrice null', () => {
    const groups = consolidateOrderItems([item({ unit_price: 0 })])
    expect(groups[0].unitPrice).toBeNull()
  })
})

// ─── computeGroupMath ────────────────────────────────────────────────────

describe('computeGroupMath', () => {
  test('encaje exacto: N=20, STD=10 → 2 paquetes, sin resto ni parado', () => {
    const m = computeGroupMath(20, 10, 100)
    expect(m).toMatchObject({
      packagesFull: 2, remainder: 0, excess: 0, parkedMoney: 0, parkedPct: 0,
    })
  })

  test('con resto: N=25, STD=10 → floor 2, resto 5, excedente 5', () => {
    const m = computeGroupMath(25, 10, 40)
    expect(m).toMatchObject({
      packagesFull: 2, remainder: 5, excess: 5, parkedMoney: 200, parkedPct: 0.5,
    })
  })

  test('N < STD: floor 0, todo es resto (ejemplo del ADR: 2 de 10 a $10)', () => {
    const m = computeGroupMath(2, 10, 10)
    expect(m).toMatchObject({
      packagesFull: 0, remainder: 2, excess: 8, parkedMoney: 80, parkedPct: 0.8,
    })
  })

  test('STD=1 nunca genera excedente', () => {
    const m = computeGroupMath(7, 1, 9999)
    expect(m).toMatchObject({ packagesFull: 7, remainder: 0, excess: 0, parkedMoney: 0 })
  })

  test('sin precio → parkedMoney null pero parkedPct sí se calcula', () => {
    const m = computeGroupMath(3, 10, null)
    expect(m.parkedMoney).toBeNull()
    expect(m.parkedPct).toBe(0.7)
  })
})

// ─── recommendPurchase ───────────────────────────────────────────────────

describe('recommendPurchase', () => {
  test('resto 0 → wholesale_exact con los paquetes completos', () => {
    const r = recommendPurchase(computeGroupMath(20, 10, 100), T)
    expect(r).toEqual({
      type: 'wholesale_exact', suggested: 'wholesale', packagesWholesale: 2, qtyRetail: 0,
    })
  })

  test('dinero parado > $100 (estricto) → mixto con resto a menudeo', () => {
    // excess 5 × $30 = $150 > 100
    const r = recommendPurchase(computeGroupMath(25, 10, 30), T)
    expect(r).toEqual({ type: 'mixed', suggested: 'mixed', packagesWholesale: 2, qtyRetail: 5 })
  })

  test('dinero parado exactamente $100 NO dispara menudeo (estricto)', () => {
    // excess 5 × $20 = $100 → no pasa el umbral; pct 0.5 < 0.8 → redondear
    const r = recommendPurchase(computeGroupMath(25, 10, 20), T)
    expect(r.type).toBe('wholesale_rounded')
  })

  test('mixto con 0 paquetes completos se sugiere como retail', () => {
    // N=2, STD=10, $50: excess 8 × 50 = $400 > 100; floor 0
    const r = recommendPurchase(computeGroupMath(2, 10, 50), T)
    expect(r).toEqual({ type: 'mixed', suggested: 'retail', packagesWholesale: 0, qtyRetail: 2 })
  })

  test('pct parado ≥ 80% (inclusivo) con dinero bajo el umbral → review sin sugerencia', () => {
    // N=2, STD=10, $10: parked $80 ≤ 100; pct 0.8 → review
    const r = recommendPurchase(computeGroupMath(2, 10, 10), T)
    expect(r).toEqual({ type: 'review', suggested: null, packagesWholesale: 0, qtyRetail: 2 })
  })

  test('precedencia: la regla de dinero gana a la de % (no llega a review)', () => {
    // N=2, STD=10, $20: parked $160 > 100 Y pct 0.8 → mixed, no review
    const r = recommendPurchase(computeGroupMath(2, 10, 20), T)
    expect(r.type).toBe('mixed')
  })

  test('excedente barato y % bajo → redondear al paquete extra', () => {
    // N=8, STD=10, $5: excess 2 × 5 = $10; pct 0.2
    const r = recommendPurchase(computeGroupMath(8, 10, 5), T)
    expect(r).toEqual({
      type: 'wholesale_rounded', suggested: 'wholesale', packagesWholesale: 1, qtyRetail: 0,
    })
  })

  test('sin precio: se salta la regla de dinero, aplica solo el % (review)', () => {
    // N=2, STD=10, sin precio: pct 0.8 → review aunque no haya dinero calculable
    const r = recommendPurchase(computeGroupMath(2, 10, null), T)
    expect(r.type).toBe('review')
  })

  test('sin precio y % bajo → wholesale_rounded', () => {
    const r = recommendPurchase(computeGroupMath(8, 10, null), T)
    expect(r.type).toBe('wholesale_rounded')
  })

  test('umbrales personalizados se respetan', () => {
    // excess 5 × $30 = $150: con umbral $200 ya no dispara mixto; pct 0.5 < 0.6
    const r = recommendPurchase(computeGroupMath(25, 10, 30), { money: 200, pct: 0.6 })
    expect(r.type).toBe('wholesale_rounded')
  })
})

// ─── applyChoice ─────────────────────────────────────────────────────────

describe('applyChoice', () => {
  const math = computeGroupMath(25, 10, 40) // floor 2, resto 5

  test('wholesale → ceil paquetes, 0 menudeo', () => {
    expect(applyChoice(math, 'wholesale')).toEqual({ packagesWholesale: 3, qtyRetail: 0 })
  })

  test('wholesale con encaje exacto no agrega paquete', () => {
    expect(applyChoice(computeGroupMath(20, 10, 40), 'wholesale')).toEqual({
      packagesWholesale: 2, qtyRetail: 0,
    })
  })

  test('mixed → floor paquetes + resto a menudeo (cobertura exacta)', () => {
    expect(applyChoice(math, 'mixed')).toEqual({ packagesWholesale: 2, qtyRetail: 5 })
  })

  test('retail → todo a menudeo', () => {
    expect(applyChoice(math, 'retail')).toEqual({ packagesWholesale: 0, qtyRetail: 25 })
  })

  test('toda elección cubre la necesidad (invariante del CHECK de BD)', () => {
    for (const choice of ['wholesale', 'mixed', 'retail'] as const) {
      const { packagesWholesale, qtyRetail } = applyChoice(math, choice)
      expect(packagesWholesale * math.std + qtyRetail).toBeGreaterThanOrEqual(math.needed)
    }
  })
})

// ─── isDecisionStale ─────────────────────────────────────────────────────

describe('isDecisionStale', () => {
  test('misma N y mismo std → fresca', () => {
    expect(isDecisionStale(decision(), 10, 10)).toBe(false)
  })

  test('cambió la necesidad → stale', () => {
    expect(isDecisionStale(decision(), 12, 10)).toBe(true)
  })

  test('cambió el std del catálogo (reimport) → stale', () => {
    expect(isDecisionStale(decision(), 10, 6)).toBe(true)
  })

  test('el grupo ya no cruza con el catálogo → stale', () => {
    expect(isDecisionStale(decision(), 10, null)).toBe(true)
  })
})

// ─── buildPurchasePlan ───────────────────────────────────────────────────

describe('buildPurchasePlan', () => {
  test('clasifica en buckets: catálogo+precio → urrea; catálogo sin precio → no_data; sin catálogo → local', () => {
    const plan = buildPurchasePlan(
      [
        item({ model_code: 'URR-1', unit_price: 100 }),
        item({ model_code: 'URR-2', unit_price: 0 }),
        item({ model_code: 'OTRA-9' }),
      ],
      catalog({
        'URREA|URR-1': { std: 10, description: 'Producto 1' },
        'URREA|URR-2': { std: 5, description: null },
      }),
      [],
      T,
    )
    expect(plan.summary).toMatchObject({ urrea: 1, noData: 1, local: 1 })
    const byCode = new Map(plan.groups.map((g) => [g.modelCode, g]))
    expect(byCode.get('URR-1')?.bucket).toBe('urrea')
    expect(byCode.get('URR-1')?.catalogDescription).toBe('Producto 1')
    expect(byCode.get('URR-2')?.bucket).toBe('no_data')
    expect(byCode.get('OTRA-9')?.bucket).toBe('local')
    expect(byCode.get('OTRA-9')?.math).toBeNull()
    expect(byCode.get('OTRA-9')?.recommendation).toBeNull()
    // Los grupos con math van antes que los locales
    expect(plan.groups[plan.groups.length - 1].bucket).toBe('local')
  })

  test('match ESTRICTO por marca: código que solo existe bajo otra marca → local', () => {
    const plan = buildPurchasePlan(
      [item({ model_code: 'URR-1', brand: 'URREA' })],
      catalog({ 'SURTEK|URR-1': { std: 10, description: 'De otra línea' } }),
      [],
      T,
    )
    expect(plan.groups[0].bucket).toBe('local')
  })

  test('consolidación antes de math: 5+5 con STD=10 → encaje exacto', () => {
    const plan = buildPurchasePlan(
      [
        item({ model_code: 'URR-1', quantity_to_order: 5 }),
        item({ model_code: 'URR-1', quantity_to_order: 5 }),
      ],
      catalog({ 'URREA|URR-1': { std: 10, description: null } }),
      [],
      T,
    )
    expect(plan.groups).toHaveLength(1)
    expect(plan.groups[0].recommendation?.type).toBe('wholesale_exact')
  })

  test('casa la decisión guardada y detecta staleness por N', () => {
    const plan = buildPurchasePlan(
      [item({ model_code: 'URR-1', quantity_to_order: 12 })],
      catalog({ 'URREA|URR-1': { std: 10, description: null } }),
      [decision({ needed_qty: 10 })], // se decidió cuando N era 10
      T,
    )
    expect(plan.groups[0].decision?.isStale).toBe(true)
    expect(plan.summary).toMatchObject({ decided: 1, stale: 1 })
  })

  test('decisión fresca cuando N y std coinciden', () => {
    const plan = buildPurchasePlan(
      [item({ model_code: 'URR-1', quantity_to_order: 10 })],
      catalog({ 'URREA|URR-1': { std: 10, description: null } }),
      [decision()],
      T,
    )
    expect(plan.groups[0].decision?.isStale).toBe(false)
    expect(plan.summary.stale).toBe(0)
  })

  test('decisión huérfana: el producto ya no está en la orden', () => {
    const plan = buildPurchasePlan(
      [item({ model_code: 'URR-2' })],
      catalog({ 'URREA|URR-2': { std: 5, description: null } }),
      [decision({ model_code: 'URR-1' })],
      T,
    )
    expect(plan.orphanDecisions).toHaveLength(1)
    expect(plan.orphanDecisions[0].model_code).toBe('URR-1')
    expect(plan.summary.decided).toBe(0)
  })

  test('std defensivo ≤ 0 en catálogo → local (no divide entre cero)', () => {
    const plan = buildPurchasePlan(
      [item({ model_code: 'URR-1' })],
      catalog({ 'URREA|URR-1': { std: 0, description: null } }),
      [],
      T,
    )
    expect(plan.groups[0].bucket).toBe('local')
  })

  test('orden sin nada que pedir → plan vacío', () => {
    const plan = buildPurchasePlan([item({ quantity_to_order: 0 })], new Map(), [], T)
    expect(plan.groups).toHaveLength(0)
    expect(plan.summary).toEqual({ urrea: 0, noData: 0, local: 0, decided: 0, stale: 0 })
  })
})
