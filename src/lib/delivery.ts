import type { DeliveryTime } from '@/types/database'
import { tokenMap } from '@/lib/tokens'

/** The assistant's tokens (#155 C6): the same in the inputs and in the answers. */
export const DELIVERY_TIME_TOKENS = tokenMap({
  immediate: 'inmediata',
  '2_3_days': '2_3_dias',
  '3_5_days': '3_5_dias',
  '1_week': '1_semana',
  '2_weeks': '2_semanas',
  indefinite: 'indefinida',
} as const satisfies Record<DeliveryTime, string>)

export const DELIVERY_TIME_LABELS: Record<DeliveryTime, string> = {
  immediate: 'Inmediato',
  '2_3_days': '2 a 3 días',
  '3_5_days': '3 a 5 días',
  '1_week':   '1 semana',
  '2_weeks':  '2 semanas',
  indefinite: 'Indefinido',
}
