'use client'

import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import type { Order, OrderStatus } from '@/types/database'

const DASHBOARD_KEY = ['dashboard']

export interface DateRange {
  from: string
  to: string
}

interface StatusCounts {
  pending_urrea_order: number
  received_from_urrea: number
  pending_payment: number
  paid: number
  completed: number
  cancelled: number
}

interface RecentOrder {
  id: string
  customer_name: string
  status: OrderStatus
  total_amount: number
  created_at: string
}

export interface DashboardData {
  etmCount: number
  inventoryCount: number
  ordersInRange: number
  totalSales: number
  statusCounts: StatusCounts
  recentOrders: RecentOrder[]
}

export function useDashboard(dateRange: DateRange) {
  const supabase = createClient()

  return useQuery({
    queryKey: [...DASHBOARD_KEY, dateRange],
    queryFn: async (): Promise<DashboardData> => {
      const [
        etmResult,
        inventoryResult,
        ordersStatusResult,
        salesResult,
        recentResult,
      ] = await Promise.all([
        // 1. Total ETM products (no date filter)
        supabase
          .from('etm_products')
          .select('*', { count: 'exact', head: true }),

        // 2. Total inventory items (no date filter)
        supabase
          .from('store_inventory')
          .select('*', { count: 'exact', head: true }),

        // 3. Orders in date range (for status breakdown)
        supabase
          .from('orders')
          .select('status')
          .gte('created_at', dateRange.from)
          .lte('created_at', dateRange.to),

        // 4. Completed/paid orders in range (for sales total)
        supabase
          .from('orders')
          .select('total_amount')
          .in('status', ['completed', 'paid'])
          .gte('created_at', dateRange.from)
          .lte('created_at', dateRange.to),

        // 5. Recent 5 orders in range
        supabase
          .from('orders')
          .select('id, customer_name, status, total_amount, created_at')
          .gte('created_at', dateRange.from)
          .lte('created_at', dateRange.to)
          .order('created_at', { ascending: false })
          .limit(5),
      ])

      if (etmResult.error) throw etmResult.error
      if (inventoryResult.error) throw inventoryResult.error
      if (ordersStatusResult.error) throw ordersStatusResult.error
      if (salesResult.error) throw salesResult.error
      if (recentResult.error) throw recentResult.error

      // Count orders by status
      const statusCounts: StatusCounts = {
        pending_urrea_order: 0,
        received_from_urrea: 0,
        pending_payment: 0,
        paid: 0,
        completed: 0,
        cancelled: 0,
      }

      const ordersData = (ordersStatusResult.data || []) as Pick<Order, 'status'>[]
      for (const order of ordersData) {
        if (order.status in statusCounts) {
          statusCounts[order.status]++
        }
      }

      // Sum sales
      const salesData = (salesResult.data || []) as Pick<Order, 'total_amount'>[]
      const totalSales = salesData.reduce(
        (sum, order) => sum + (order.total_amount || 0),
        0
      )

      return {
        etmCount: etmResult.count || 0,
        inventoryCount: inventoryResult.count || 0,
        ordersInRange: ordersData.length,
        totalSales,
        statusCounts,
        recentOrders: (recentResult.data || []) as RecentOrder[],
      }
    },
  })
}
