/**
 * Parsea errores de Postgres (vía Supabase) y los traduce a mensajes en
 * español, identificando — cuando es posible — el ítem ofensor.
 *
 * Razón: por defecto Supabase devuelve mensajes como
 *   "new row for relation \"quotation_items\" violates check constraint
 *    \"quotation_items_quantity_check\""
 * lo cual el usuario no entiende. Esta utilidad mapea las CHECK/UNIQUE/FK
 * conocidas del proyecto a textos accionables ("ETM X: cantidad debe ser
 * mayor a 0") y, escaneando el array de ítems que se intentó insertar,
 * regresa el `etm` del primer ítem que viola la regla.
 */

export interface PgErrorInput {
  message?: string | null
  details?: string | null
  hint?: string | null
  code?: string | null
}

/** Subconjunto del shape de ítem usado para escanear en busca del ofensor. */
export interface InspectableItem {
  etm?: string | null
  quantity?: number | null
  quantity_approved?: number | null
  unit_price?: number | null
  quantity_in_stock?: number | null
  quantity_to_order?: number | null
}

export interface PgErrorExplanation {
  /** Mensaje en español, listo para mostrar al usuario. */
  userMessage: string
  /** ETM del ítem ofensor cuando pudo identificarse. */
  offendingEtm?: string
  /** True si es violación de regla de negocio (responder 400, no 500). */
  isConstraintViolation: boolean
  /** Nombre crudo de la constraint, útil para debugging/logs. */
  constraintName?: string
}

const ERR_UNKNOWN: PgErrorExplanation = {
  userMessage: 'Ocurrió un error desconocido.',
  isConstraintViolation: false,
}

/** Extrae el nombre de la constraint del mensaje de Postgres. */
function extractConstraint(msg: string): string | undefined {
  // Formato típico: '... violates check constraint "name"' o
  // '... unique constraint "name"' / '... foreign key constraint "name"'.
  const m = msg.match(/constraint "([a-z0-9_]+)"/i)
  return m?.[1]
}

/** ¿Es una violación de CHECK reconocible por code o sufijo? */
function isCheckViolation(code: string, constraint?: string): boolean {
  return code === '23514' || constraint?.endsWith('_check') === true || constraint?.startsWith('check_') === true
}
/** ¿Es una violación de UNIQUE reconocible? */
function isUniqueViolation(code: string, constraint?: string): boolean {
  return code === '23505' || constraint?.endsWith('_key') === true || constraint?.endsWith('_unique') === true
}
/** ¿Es una violación de FK reconocible? */
function isFkViolation(code: string, constraint?: string): boolean {
  return code === '23503' || constraint?.endsWith('_fkey') === true
}

/** Helpers para buscar el ítem ofensor según el tipo de constraint. */
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

/**
 * Traduce un error de Postgres a un mensaje accionable.
 *
 * @param error  El objeto error de Supabase/Postgres.
 * @param items  (opcional) Array de ítems que se intentó insertar. Si se
 *               provee, se escanea para identificar el `etm` ofensor y
 *               personalizar el mensaje.
 */
export function explainPgError(
  error: PgErrorInput | null | undefined,
  items?: InspectableItem[],
): PgErrorExplanation {
  if (!error) return ERR_UNKNOWN

  const msg = error.message ?? ''
  const details = error.details ?? ''
  const code = error.code ?? ''
  const constraint = extractConstraint(msg) ?? extractConstraint(details)

  // ── CHECK constraint (23514) ──────────────────────────────────────
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

  // ── UNIQUE constraint (23505) ─────────────────────────────────────
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

  // ── FK violation (23503) ──────────────────────────────────────────
  if (isFkViolation(code, constraint)) {
    return {
      userMessage: 'Recurso relacionado no encontrado o eliminado.',
      isConstraintViolation: true,
      constraintName: constraint,
    }
  }

  // ── NOT NULL violation (23502) ────────────────────────────────────
  if (code === '23502') {
    return {
      userMessage: 'Falta un campo requerido.',
      isConstraintViolation: true,
    }
  }

  // ── Fallback ──────────────────────────────────────────────────────
  return {
    userMessage: msg || 'Ocurrió un error al guardar.',
    isConstraintViolation: false,
  }
}
