import type { OrderStatus } from '@/types/database'

/** Every order status, in the order of the flow (the MCP's enum, #155 C1). */
export const ORDER_STATUSES = ['ordered', 'received', 'delivered', 'completed', 'cancelled'] as const satisfies readonly OrderStatus[]
