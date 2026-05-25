import type { DeliveryTime } from '@/types/database'

export const DELIVERY_TIME_LABELS: Record<DeliveryTime, string> = {
  immediate: 'Inmediato',
  '2_3_days': '2 a 3 días',
  '3_5_days': '3 a 5 días',
  '1_week':   '1 semana',
  '2_weeks':  '2 semanas',
  indefinite: 'Indefinido',
}
