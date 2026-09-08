/**
 * Render helper: wraps the tree in a QueryClientProvider with a fresh client per call, so
 * components touching the TanStack Query context work even with mocked hooks.
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

/** Preconfigured userEvent; call `const user = setupUser()` at the top of the test. */
export const setupUser = () => userEvent.setup()

export * from '@testing-library/react'
export { userEvent }
