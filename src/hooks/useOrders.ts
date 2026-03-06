'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import type {
  Order,
  OrderWithItems,
  OrderStatus,
  DeliveryTime,
  CreateOrderInput,
  ConfirmReceptionInput,
} from '@/types/database'

const ORDERS_KEY = ['orders']

interface OrdersParams {
  page?: number
  pageSize?: number
  search?: string
  status?: OrderStatus | 'all'
}

interface OrdersResponse {
  data: Order[]
  count: number
  page: number
  pageSize: number
  totalPages: number
}

export function useOrders(params: OrdersParams = {}) {
  const { page = 1, pageSize = 20, search = '', status = 'all' } = params
  const supabase = createClient()

  return useQuery({
    queryKey: [...ORDERS_KEY, { page, pageSize, search, status }],
    queryFn: async (): Promise<OrdersResponse> => {
      let query = supabase
        .from('orders')
        .select('*', { count: 'exact' })

      if (search) {
        query = query.ilike('customer_name', `%${search}%`)
      }

      if (status !== 'all') {
        query = query.eq('status', status)
      }

      const from = (page - 1) * pageSize
      const to = from + pageSize - 1

      const { data, error, count } = await query
        .order('created_at', { ascending: false })
        .range(from, to)

      if (error) throw error

      return {
        data: data || [],
        count: count || 0,
        page,
        pageSize,
        totalPages: Math.ceil((count || 0) / pageSize),
      }
    },
  })
}

export function useOrder(id: string) {
  const supabase = createClient()

  return useQuery({
    queryKey: [...ORDERS_KEY, id],
    queryFn: async (): Promise<OrderWithItems | null> => {
      const { data: order, error: orderError } = await supabase
        .from('orders')
        .select('*')
        .eq('id', id)
        .single()

      if (orderError) throw orderError
      if (!order) return null

      const { data: items, error: itemsError } = await supabase
        .from('order_items')
        .select('*')
        .eq('order_id', id)
        .order('etm', { ascending: true })

      if (itemsError) throw itemsError

      return {
        ...order,
        order_items: items || [],
      }
    },
    enabled: !!id,
  })
}

export function useCreateOrder() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: CreateOrderInput) => {
      const response = await fetch('/api/orders/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.message || 'Error al crear orden')
      }

      return response.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ORDERS_KEY })
    },
  })
}

export function useUpdateOrderStatus() {
  const queryClient = useQueryClient()
  const supabase = createClient()

  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: OrderStatus }) => {
      const { data, error } = await supabase
        .from('orders')
        .update({ status })
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ORDERS_KEY })
      queryClient.invalidateQueries({ queryKey: [...ORDERS_KEY, variables.id] })
    },
  })
}

export function useConfirmReception() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ orderId, input }: { orderId: string; input: ConfirmReceptionInput }) => {
      const response = await fetch(`/api/orders/${orderId}/confirm-reception`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.message || 'Error al confirmar recepción')
      }

      return response.json()
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ORDERS_KEY })
      queryClient.invalidateQueries({ queryKey: [...ORDERS_KEY, variables.orderId] })
    },
  })
}

export function useCancelOrder() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (orderId: string) => {
      const response = await fetch(`/api/orders/${orderId}/cancel`, {
        method: 'POST',
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.message || 'Error al cancelar orden')
      }

      return response.json()
    },
    onSuccess: (_, orderId) => {
      queryClient.invalidateQueries({ queryKey: ORDERS_KEY })
      queryClient.invalidateQueries({ queryKey: [...ORDERS_KEY, orderId] })
    },
  })
}

export interface AddOrderItemInput {
  etm: string
  description: string
  model_code: string
  brand: string
  unit_price: number
  quantity_approved: number
}

export function useAddOrderItem() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ orderId, item }: { orderId: string; item: AddOrderItemInput }) => {
      const response = await fetch(`/api/orders/${orderId}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item),
      })
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.message || 'Error al agregar el producto')
      }
      return response.json()
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ORDERS_KEY })
      queryClient.invalidateQueries({ queryKey: [...ORDERS_KEY, variables.orderId] })
    },
  })
}

export function useEditOrderItem() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      orderId,
      itemId,
      unit_price,
    }: {
      orderId: string
      itemId: string
      unit_price: number
    }) => {
      const response = await fetch(`/api/orders/${orderId}/items/${itemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unit_price }),
      })
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.message || 'Error al editar el producto')
      }
      return response.json()
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ORDERS_KEY })
      queryClient.invalidateQueries({ queryKey: [...ORDERS_KEY, variables.orderId] })
    },
  })
}

export function useEditDeliveryTime() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      orderId,
      itemId,
      delivery_time,
    }: {
      orderId: string
      itemId: string
      delivery_time: DeliveryTime
    }) => {
      const response = await fetch(`/api/orders/${orderId}/items/${itemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ delivery_time }),
      })
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.message || 'Error al actualizar tiempo de entrega')
      }
      return response.json()
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ORDERS_KEY })
      queryClient.invalidateQueries({ queryKey: [...ORDERS_KEY, variables.orderId] })
    },
  })
}

export function useRemoveOrderItem() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ orderId, itemId }: { orderId: string; itemId: string }) => {
      const response = await fetch(`/api/orders/${orderId}/items/${itemId}`, {
        method: 'DELETE',
      })
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.message || 'Error al eliminar el producto')
      }
      return response.json()
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ORDERS_KEY })
      queryClient.invalidateQueries({ queryKey: [...ORDERS_KEY, variables.orderId] })
    },
  })
}

export function useAutoLearn() {
  return useMutation({
    mutationFn: async (products: CreateOrderInput['products']) => {
      const response = await fetch('/api/orders/auto-learn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ products }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.message || 'Error en auto-aprendizaje')
      }

      return response.json()
    },
  })
}
