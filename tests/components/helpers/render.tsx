/**
 * Render helper para tests de componentes.
 *
 * Envuelve el árbol en un QueryClientProvider con un cliente nuevo por llamada
 * (retry off, sin staleTime) para que los componentes que tocan el contexto de
 * TanStack Query funcionen aunque sus hooks estén mockeados.
 */

import type { ReactElement, ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, type RenderOptions } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  })
}

export function renderWithProviders(ui: ReactElement, options?: Omit<RenderOptions, 'wrapper'>) {
  const client = makeClient()
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, ...render(ui, { wrapper, ...options }) }
}

/** userEvent ya configurado; usar `const user = setupUser()` al inicio del test. */
export const setupUser = () => userEvent.setup()

export * from '@testing-library/react'
export { userEvent }
