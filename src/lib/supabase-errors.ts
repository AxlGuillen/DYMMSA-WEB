/** Postgres errors → actionable Spanish messages, naming the offending ETM when the insert items
 *  are passed in (ADR-009). */

export interface PgErrorInput {
  message?: string | null
  details?: string | null
  hint?: string | null
  code?: string | null
}

/** Item subset needed to scan for the offender. */
export interface InspectableItem {
  etm?: string | null
  quantity?: number | null
  quantity_approved?: number | null
  unit_price?: number | null
  quantity_in_stock?: number | null
  quantity_to_order?: number | null
}

export interface PgErrorExplanation {
  /** Display-ready message (Spanish). */
  userMessage: string
  /** Offending item's ETM, when it could be identified. */
  offendingEtm?: string
  /** True on a business-rule violation: answer 400, not 500. */
  isConstraintViolation: boolean
  /** Raw constraint name, for logs. */
  constraintName?: string
}

const ERR_UNKNOWN: PgErrorExplanation = {
  userMessage: 'Ocurrió un error desconocido.',
  isConstraintViolation: false,
}

function extractConstraint(msg: string): string | undefined {
  // Typical shapes: '... violates check constraint "name"', '... unique constraint "name"',
  // '... foreign key constraint "name"'.
  const m = msg.match(/constraint "([a-z0-9_]+)"/i)
  return m?.[1]
}

/** CHECK violation, by code or by constraint suffix. */
function isCheckViolation(code: string, constraint?: string): boolean {
  return code === '23514' || constraint?.endsWith('_check') === true || constraint?.startsWith('check_') === true
}
/** UNIQUE violation, by code or by constraint suffix. */
function isUniqueViolation(code: string, constraint?: string): boolean {
  return code === '23505' || constraint?.endsWith('_key') === true || constraint?.endsWith('_unique') === true
}
/** FK violation, by code or by constraint suffix. */
function isFkViolation(code: string, constraint?: string): boolean {
  return code === '23503' || constraint?.endsWith('_fkey') === true
}

function findByZeroOrNullQuantity(items: InspectableItem[]): InspectableItem | undefined {
  return items.find(
    (i) => i.quantity == null || (typeof i.quantity === 'number' && i.quantity <= 0),
  )
}
function findByZeroOrNullQuantityApproved(items: InspectableItem[]): InspectableItem | undefined {
  return items.find(
    (i) =>
      i.quantity_approved != null &&
      typeof i.quantity_approved === 'number' &&
      i.quantity_approved <= 0,
  )
}
function findByNegativePrice(items: InspectableItem[]): InspectableItem | undefined {
  return items.find((i) => typeof i.unit_price === 'number' && i.unit_price < 0)
}

/** Postgres error → actionable message; with `items` it names the offending ETM. */
export function explainPgError(
  error: PgErrorInput | null | undefined,
  items?: InspectableItem[],
): PgErrorExplanation {
  if (!error) return ERR_UNKNOWN

  const msg = error.message ?? ''
  const details = error.details ?? ''
  const code = error.code ?? ''
  const constraint = extractConstraint(msg) ?? extractConstraint(details)

  if (isCheckViolation(code, constraint)) {
    switch (constraint) {
      case 'quotation_items_quantity_check': {
        const bad = items && findByZeroOrNullQuantity(items)
        return {
          userMessage: bad?.etm
            ? `El producto con ETM "${bad.etm}" tiene cantidad 0 o vacía. La cantidad debe ser mayor a 0.`
            : 'Hay un producto con cantidad 0 o vacía. La cantidad debe ser mayor a 0.',
          offendingEtm: bad?.etm ?? undefined,
          isConstraintViolation: true,
          constraintName: constraint,
        }
      }
      case 'quotation_items_price_check': {
        const bad = items && findByNegativePrice(items)
        return {
          userMessage: bad?.etm
            ? `El producto con ETM "${bad.etm}" tiene precio negativo.`
            : 'Hay un producto con precio negativo.',
          offendingEtm: bad?.etm ?? undefined,
          isConstraintViolation: true,
          constraintName: constraint,
        }
      }
      case 'order_items_quantity_approved_check': {
        const bad = items && findByZeroOrNullQuantityApproved(items)
        return {
          userMessage: bad?.etm
            ? `El producto aprobado con ETM "${bad.etm}" tiene cantidad 0. Debe ser mayor a 0 para generar la orden.`
            : 'Un producto aprobado tiene cantidad 0. Debe ser mayor a 0 para generar la orden.',
          offendingEtm: bad?.etm ?? undefined,
          isConstraintViolation: true,
          constraintName: constraint,
        }
      }
      case 'order_items_unit_price_check': {
        const bad = items && findByNegativePrice(items)
        return {
          userMessage: bad?.etm
            ? `El producto con ETM "${bad.etm}" tiene precio negativo.`
            : 'Hay un producto con precio negativo en la orden.',
          offendingEtm: bad?.etm ?? undefined,
          isConstraintViolation: true,
          constraintName: constraint,
        }
      }
      case 'check_quantity_sum':
        return {
          userMessage:
            'Error interno: las cantidades del pedido (en stock + por pedir) no cuadran con la cantidad aprobada. Reintenta o reporta al equipo.',
          isConstraintViolation: true,
          constraintName: constraint,
        }
      case 'store_inventory_quantity_check':
        return {
          userMessage:
            'El stock cambió mientras se procesaba la operación y quedaría en negativo. Recarga e intenta de nuevo.',
          isConstraintViolation: true,
          constraintName: constraint,
        }
      case 'order_items_quantity_in_stock_check':
      case 'order_items_quantity_to_order_check':
      case 'order_items_quantity_received_check':
        return {
          userMessage: 'Una de las cantidades de la orden es negativa. Reintenta.',
          isConstraintViolation: true,
          constraintName: constraint,
        }
      case 'check_decision_covers_needed':
        return {
          userMessage:
            'La decisión de compra no cubre la cantidad necesaria (paquetes × STD + menudeo debe ser al menos la necesidad). Recalcula en el planificador.',
          isConstraintViolation: true,
          constraintName: constraint,
        }
      case 'quotations_total_check':
      case 'orders_total_amount_check':
        return {
          userMessage:
            'El total calculado es negativo. Revisa precios y cantidades de los productos.',
          isConstraintViolation: true,
          constraintName: constraint,
        }
      case 'quotations_status_check':
      case 'orders_status_check':
      case 'order_items_delivery_time_check':
      case 'order_items_urrea_status_check':
        return {
          userMessage:
            'Estado o valor de enumeración inválido. Reporta este error al equipo.',
          isConstraintViolation: true,
          constraintName: constraint,
        }
      default:
        return {
          userMessage: `Validación de base de datos fallida${constraint ? ` (${constraint})` : ''}.`,
          isConstraintViolation: true,
          constraintName: constraint,
        }
    }
  }

  if (isUniqueViolation(code, constraint)) {
    if (
      constraint === 'etm_products_etm_unique' ||
      constraint === 'etm_products_etm_key'
    ) {
      return {
        userMessage:
          'El ETM ya existe en el catálogo. Si quieres actualizarlo, edítalo desde la base de datos.',
        isConstraintViolation: true,
        constraintName: constraint,
      }
    }
    if (constraint === 'store_inventory_model_code_key') {
      return {
        userMessage: 'El código de modelo ya existe en el inventario.',
        isConstraintViolation: true,
        constraintName: constraint,
      }
    }
    return {
      userMessage: 'Conflicto: el recurso ya existe.',
      isConstraintViolation: true,
      constraintName: constraint,
    }
  }

  if (isFkViolation(code, constraint)) {
    return {
      userMessage: 'Recurso relacionado no encontrado o eliminado.',
      isConstraintViolation: true,
      constraintName: constraint,
    }
  }

  if (code === '23502') {
    return {
      userMessage: 'Falta un campo requerido.',
      isConstraintViolation: true,
    }
  }

  return {
    userMessage: msg || 'Ocurrió un error al guardar.',
    isConstraintViolation: false,
  }
}
