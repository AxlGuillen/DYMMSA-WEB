'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchJson } from '@/lib/fetch-json'
import type { EmployeeInput, PayrollView } from '@/lib/payroll'
import type { DayInput, PrefillResult, SaveDaysResult } from '@/lib/payroll-store'
import type { PayrollEmployee, PayrollPeriod } from '@/types/database'

const PAYROLL_KEY = ['payroll']
const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
})

/** The Saturday→Friday cut starting at `start` (admin only; the API answers 403 otherwise). */
export function usePayrollPeriod(start: string) {
  return useQuery({
    queryKey: [...PAYROLL_KEY, 'period', start],
    queryFn: () => fetchJson<PayrollView>(`/api/payroll/periods/${start}`),
  })
}

export function usePayrollEmployees(enabled = true) {
  return useQuery({
    queryKey: [...PAYROLL_KEY, 'employees'],
    queryFn: () => fetchJson<PayrollEmployee[]>('/api/payroll/employees'),
    enabled,
  })
}

function useInvalidatePayroll() {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: PAYROLL_KEY })
}

export function useSavePayrollDay() {
  const invalidate = useInvalidatePayroll()
  return useMutation({
    mutationFn: (day: DayInput) =>
      fetchJson<SaveDaysResult & { deleted: boolean }>('/api/payroll/days', json('PUT', day)),
    onSuccess: invalidate,
  })
}

export function usePrefillPayroll() {
  const invalidate = useInvalidatePayroll()
  return useMutation({
    mutationFn: (start: string) =>
      fetchJson<PrefillResult>(`/api/payroll/periods/${start}/prefill`, json('POST')),
    onSuccess: invalidate,
  })
}

export function useConfirmPayroll() {
  const invalidate = useInvalidatePayroll()
  return useMutation({
    mutationFn: (start: string) =>
      fetchJson<{ confirmed: number }>(`/api/payroll/periods/${start}/confirm`, json('POST')),
    onSuccess: invalidate,
  })
}

export function useSetPayrollClosed() {
  const invalidate = useInvalidatePayroll()
  return useMutation({
    mutationFn: ({ start, closed }: { start: string; closed: boolean }) =>
      fetchJson<PayrollPeriod>(`/api/payroll/periods/${start}`, json('PATCH', { closed })),
    onSuccess: invalidate,
  })
}

export function useSavePayrollEmployee() {
  const invalidate = useInvalidatePayroll()
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: EmployeeInput }) =>
      id
        ? fetchJson<PayrollEmployee>(`/api/payroll/employees/${id}`, json('PATCH', input))
        : fetchJson<PayrollEmployee>('/api/payroll/employees', json('POST', input)),
    onSuccess: invalidate,
  })
}
