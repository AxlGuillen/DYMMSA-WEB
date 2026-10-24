import type { OrderStatus } from '@/types/database'
import { tokenMap } from '@/lib/tokens'

/** The assistant's tokens (#155 C6, ADR-041 §7): the same in the filters and in the answers. */
export const ORDER_STATUS_TOKENS = tokenMap({
  ordered: 'pedida',
  received: 'recibida',
  delivered: 'entregada',
  completed: 'completada',
  cancelled: 'cancelada',
} as const satisfies Record<OrderStatus, string>)

/** What URREA did with a line (order_items.urrea_status). */
export const URREA_STATUS_TOKENS = tokenMap({
  pending: 'pendiente',
  supplied: 'surtido',
  not_supplied: 'no_surtido',
} as const)

/** Every order status, in the order of the flow (the MCP's enum, #155 C1). */
export const ORDER_STATUSES = ['ordered', 'received', 'delivered', 'completed', 'cancelled'] as const satisfies readonly OrderStatus[]
